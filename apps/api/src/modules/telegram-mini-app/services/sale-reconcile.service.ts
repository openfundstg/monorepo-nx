import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Types } from 'mongoose'
import { SaleEventType, TmaSaleStatus } from '@transacto/contracts'
import { BankScraperService } from 'src/modules/bank-scraper'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { describeError, isDeadJarError } from 'src/shared/utils'

type StoredSale = TmaSale & { _id: Types.ObjectId }

/**
 * Asks the bank about the jars nobody is watching, and unsticks what it finds.
 *
 * A sale slot is released when the jar behind the order is closed, and
 * the only thing that ever notices a closure is the scrape loop. That leaves a
 * gap the rest of the system cannot close by itself: **a terminal that is no
 * longer scraped can never report anything**, so an order attached to one holds
 * its user's slot for good, whatever they do with the jar.
 *
 * Every order that ended before the jar rule existed is in exactly that state —
 * its terminal was retired at completion, under the behaviour of the time — and
 * the users affected saw a slot count that could not come down no matter how
 * many jars they closed. That is what this sweep is for, and it is not a
 * migration: a terminal can fall out of the loop at any time, and the same trap
 * would close again behind it.
 *
 * So the question is answered where the answer actually lives — by asking the
 * bank. Nothing here trusts the local state to be current; that is the state
 * that was wrong.
 */
@Injectable()
export class SaleReconcileService {
  private readonly logger = new Logger(SaleReconcileService.name)

  /** One pass at a time: it makes network calls and can settle orders. */
  private running = false

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly terminalDbService: TerminalDbService,
    private readonly bankScraperService: BankScraperService,
    private readonly cancelService: SaleCancelService
  ) {}

  /**
   * Every five minutes, not every thirty seconds.
   *
   * A pass costs one request to a bank per unwatched jar, and nothing it finds
   * is urgent — a slot that has been stuck since a release is not made worse by
   * another few minutes, and hammering three banks on a tighter loop to learn
   * the same thing would be its own problem.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileHeldSlots(): Promise<void> {
    if (this.running) {
      this.logger.debug('Reconciliation already in progress, skipping')
      return
    }

    this.running = true
    try {
      const held = await this.saleDbService.findHoldingSlots()

      for (const order of held) {
        // One jar's failure must not strand every order behind it.
        try {
          await this.reconcile(order)
        } catch (error: unknown) {
          this.logger.error(
            `Could not reconcile sale ${order.publicId}: ${describeError(error)}`
          )
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Reconciliation sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /**
   * Settles what one order's jar has to say, if anyone needs to ask.
   *
   * Skipped entirely for a terminal that is still enabled: the scrape loop has
   * it, and a second request to the same bank would learn what the loop already
   * knows. This exists for the ones the loop has let go of.
   */
  private async reconcile(order: StoredSale): Promise<void> {
    if (order.cardId === null || order.transactoTerminalId === null) return

    // Keyed by `terminalId`, which identifies one terminal on its own. A
    // `cardId` does not: every other path in this codebase reads a terminal by
    // `{ traderId, cardId }` — the sale stores `traderId` for exactly
    // that reason — and a lookup on the card alone can return a different
    // trader's row, so the `enabled` below would be about the wrong terminal.
    // `BankScraperService.scrape` keys the same way, so the row checked here is
    // the row that would be probed.
    const terminal = await this.terminalDbService.findOne({
      terminalId: order.transactoTerminalId
    })
    if (terminal?.enabled) return

    if (!(await this.jarIsGone(order))) return

    this.logger.log(
      `Sale ${order.publicId}: its jar is gone and nothing was watching. Releasing.`
    )

    // The slot, for an order that has already ended. `markJarClosedByCardId`
    // covers every order on the same card, which is what the reported case
    // needed: two orders had been created against one jar, and both were stuck.
    await this.saleDbService.markJarClosedByCardId(order.cardId)

    // And the stake, for one that never got to end. A closed jar can receive
    // nothing, so this order was never going to complete or expire on its own —
    // it would have sat open with the user's USDT frozen for good.
    if (this.isOpen(order.status)) {
      await this.cancelService.settle(order, SaleEventType.JAR_CLOSED)
    }
  }

  /**
   * Asks the bank, and answers only when it is sure.
   *
   * A scrape that fails for any other reason — a proxy, a timeout, a bank
   * having a bad minute — is **not** a closed jar, and must not be read as one:
   * releasing a slot on a network blip would hand back the very freedom the
   * rule exists to withhold, and settling an open order on one would refund a
   * stake against a jar still able to take money. Those failures wait for the
   * next pass, which is five minutes away.
   */
  private async jarIsGone(order: StoredSale): Promise<boolean> {
    try {
      await this.bankScraperService.scrape(order.transactoTerminalId as number)

      return false
    } catch (error: unknown) {
      if (isDeadJarError(error)) return true

      this.logger.debug(
        `Could not read the jar for sale ${order.publicId}, leaving it as it is: ` +
          describeError(error)
      )

      return false
    }
  }

  private isOpen(status: TmaSaleStatus): boolean {
    return (
      status === TmaSaleStatus.CREATED ||
      status === TmaSaleStatus.TERMINAL_READY ||
      status === TmaSaleStatus.AWAITING_FIAT ||
      status === TmaSaleStatus.CLOSING
    )
  }
}
