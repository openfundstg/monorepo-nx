import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleSettlementService } from 'src/modules/telegram-mini-app/services/sale-settlement.service'
import { describeError, isSaleInTail, transactoOrderFloorKopecks } from 'src/shared/utils'

/**
 * Re-examines the sales that are in their tail, because nothing else will.
 *
 * **Every other path that notices a tail is driven by something happening**: an
 * order settling, a jar being scraped, a statement being accepted. That covers
 * every tail a sale *enters* — the settlement which created it is the one that
 * parks it and asks for the transfer.
 *
 * It does not cover a tail that was already there. A sale sitting on a gap under
 * the floor has, by definition, no further order coming and no payer to scrape
 * for, so on a card sale nothing happens to it ever again. Every such sale at
 * the moment this shipped would have waited for good: parked by nobody, with no
 * operator told and no clock started. This is the pass that picks them up.
 *
 * It keeps earning its place afterwards, for the same reason
 * `SaleClosingService` is a poll rather than a subscription: a tail whose
 * announcement was held for a statement comes back through the statement path,
 * a restart mid-write does not, and one query every five minutes needs neither
 * to be reliable.
 *
 * **It decides nothing of its own.** Whether a tail is parked, announced or
 * settled is `settleIfFinished`'s, so this cannot come to disagree with the
 * paths that run on every order — it only makes sure the question gets asked.
 */
@Injectable()
export class SaleTailSweepService {
  private readonly logger = new Logger(SaleTailSweepService.name)

  /** One pass at a time: a settlement moves money and must not overlap itself. */
  private running = false

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly settlement: SaleSettlementService
  ) {}

  /**
   * Never throws, and costs one indexed query when nothing is in a tail —
   * which is most of the time, and most of the sales it reads.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepTails(): Promise<void> {
    if (this.running) {
      this.logger.debug('Tail sweep already in progress, skipping')

      return
    }

    this.running = true
    try {
      const floorKopecks = transactoOrderFloorKopecks()
      // Filtered here with the same function every other caller uses, rather
      // than asked of the database — see `findOpenWithMoney` for why the query
      // is the wider one.
      const inTail = (await this.saleDbService.findOpenWithMoney()).filter((sale) =>
        isSaleInTail(sale, floorKopecks)
      )

      if (inTail.length === 0) return

      this.logger.debug(`Tail sweep: ${inTail.length} sale(s) sitting on an unfillable gap`)

      for (const sale of inTail) {
        // One failure must not strand every other sale waiting behind it.
        try {
          await this.settlement.settleIfFinished(sale._id.toString(), sale)
        } catch (error: unknown) {
          this.logger.error(
            `Tail sweep could not re-examine sale ${sale.publicId}: ${describeError(error)}`
          )
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Tail sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }
}
