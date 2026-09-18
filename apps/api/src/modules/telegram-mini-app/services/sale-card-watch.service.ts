import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SaleCardOrderState } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import { describeError } from 'src/shared/utils'

/**
 * Notices a card sale's order that nobody answered in time.
 *
 * The card variant asks a person a question, and a question can go unanswered.
 * When the window runs out the order becomes a dispute: routing to the terminal
 * stops, so no further money lands somewhere an open question already is, and
 * the seller is asked for a statement instead of a tap.
 *
 * **Silence is treated exactly as a denial, not more leniently.** In both cases
 * nothing has established that the hryvnia arrived, and this variant has no
 * second record to fall back on. What softens it is that the seller can still
 * confirm afterwards: `DISPUTED` is a state a confirmation is accepted from, and
 * an order Transacto has marked `OVERDUE` is still executable — a late payer's
 * money is still money, and so is a late seller's answer.
 *
 * **A poll rather than a timer**, for the reason `SaleClosingService` gives: a
 * scheduled callback does not survive a restart, and the deadline is a fact on
 * the document rather than something held in this process's memory.
 */
@Injectable()
export class SaleCardWatchService {
  private readonly logger = new Logger(SaleCardWatchService.name)

  /** One pass at a time: a dispute stops a terminal and must not overlap itself. */
  private running = false

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly cardOrders: SaleCardOrderService
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async disputeUnansweredOrders(): Promise<void> {
    if (this.running) {
      this.logger.debug('Card order sweep already in progress, skipping')
      return
    }

    this.running = true
    try {
      const now = new Date()
      const sales = await this.saleDbService.findCardOrdersPastDeadline(now)
      if (sales.length === 0) return

      for (const sale of sales) {
        // One failure must not strand every other sale waiting behind it.
        try {
          await this.disputeOverdue(sale, now)
        } catch (error: unknown) {
          this.logger.error(
            `Could not dispute overdue orders on sale ${sale.publicId}: ${describeError(error)}`
          )
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Card order sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /**
   * Disputes every overdue order on one sale.
   *
   * A loop rather than a single lookup even though the credential is capped at
   * one open order, because that cap is Transacto's to enforce and this sweep
   * is not the place to discover it has slipped. Each order is answered on its
   * own; the first dispute stops routing, and the rest are no-ops on a terminal
   * that is already stopped.
   */
  private async disputeOverdue(
    sale: Awaited<ReturnType<TmaSaleDbService['findCardOrdersPastDeadline']>>[number],
    now: Date
  ): Promise<void> {
    const overdue = (sale.cardOrders ?? []).filter(
      (order) =>
        order.state === SaleCardOrderState.AWAITING_CONFIRMATION &&
        order.confirmDeadlineAt <= now
    )

    // Re-read between orders, because each dispute rewrites the document and
    // the next one has to act on what the first left behind — above all on
    // whether routing has already been stopped.
    let latest = sale
    for (const order of overdue) {
      const disputed = await this.cardOrders.expire(latest, order)
      if (disputed) latest = disputed
    }
  }
}
