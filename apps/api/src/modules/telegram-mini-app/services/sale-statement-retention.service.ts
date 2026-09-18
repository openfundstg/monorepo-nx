import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import environments from 'src/environments'
import { DAY_MS } from 'src/shared/constants'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleStatementStorageService } from 'src/modules/telegram-mini-app/services/sale-statement-storage.service'
import { describeError } from 'src/shared/utils'

/**
 * How long a statement's bytes are kept, in days, when nothing says otherwise.
 *
 * Ninety, which is far longer than any appeal and far shorter than forever. The
 * figure is a compromise between two real costs and the comment is where the
 * compromise is stated: too short and an operator loses the document a dispute
 * turned on while somebody is still arguing about it; too long and the product
 * is holding the complete spending history of everybody who ever denied a
 * payment, for no purpose anybody could name.
 */
const DEFAULT_RETENTION_DAYS = 90

/**
 * Deleting statements once nothing needs them.
 *
 * **The one sweep in this product whose purpose is to destroy data**, and it
 * exists because the alternative is worse than it looks. A statement is the
 * most sensitive document here — somebody's whole transaction history, handed
 * over to answer one question about one payment — and a store that only ever
 * grows turns a feature for settling disputes into an archive of everybody who
 * ever had one.
 *
 * **What goes is the file; what stays is the record.** The verdict, the period
 * the document covered and the account holder it named remain on the sale
 * forever: that is the audit trail, and it is what lets somebody months later
 * see *why* an order was settled the way it was. Only the bytes are somebody's
 * private history, and only the bytes go.
 *
 * Ordered so a failure leaves the safe state: the file is removed first and the
 * row marked afterwards. A row marked purged with the file still on disk is a
 * document nothing points at and nothing will ever remove — the one outcome
 * this must not produce. The other way round costs a second attempt tomorrow.
 */
@Injectable()
export class SaleStatementRetentionService {
  private readonly logger = new Logger(SaleStatementRetentionService.name)

  /** One pass at a time: a sweep that overlaps itself deletes twice. */
  private running = false

  constructor(
    private readonly saleDb: TmaSaleDbService,
    private readonly storage: SaleStatementStorageService
  ) {}

  /**
   * Daily, and at a quiet hour.
   *
   * Nothing depends on it being prompt — a document a day past its retention is
   * no more sensitive than it was yesterday — so it runs where it competes with
   * nothing.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredStatements(): Promise<void> {
    if (this.running) {
      this.logger.debug('Statement retention sweep already in progress, skipping')
      return
    }

    this.running = true
    try {
      const cutoff = new Date(Date.now() - this.retentionDays() * DAY_MS)
      const sales = await this.saleDb.findSalesWithStatementsBefore(cutoff)
      if (sales.length === 0) return

      let purged = 0

      for (const sale of sales) {
        const saleId = sale._id.toString()

        const expired = (sale.cardOrders ?? []).flatMap((cardOrder) =>
          (cardOrder.statements ?? []).filter(
            (statement) => statement.purgedAt === null && statement.uploadedAt < cutoff
          )
        )

        for (const statement of expired) {
          // One failure must not strand every other document behind it.
          try {
            await this.storage.remove(statement.storedName)
            if (await this.saleDb.markStatementPurged(saleId, statement._id)) purged += 1
          } catch (error: unknown) {
            this.logger.error(
              `Could not purge statement ${statement._id.toString()}: ${describeError(error)}`
            )
          }
        }
      }

      // Counts only. Which sale, which seller and what was in the document are
      // all things this sweep deliberately says nothing about.
      if (purged > 0) this.logger.log(`Retention: deleted ${purged} statement file(s)`)
    } catch (error: unknown) {
      this.logger.error(`Statement retention sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /** Read per pass, so a deployment can shorten it without a restart. */
  private retentionDays(): number {
    const configured = Number(environments.SALE_STATEMENT_RETENTION_DAYS)

    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
  }
}
