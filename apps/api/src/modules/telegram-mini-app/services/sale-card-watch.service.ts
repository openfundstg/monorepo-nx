import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SaleCardOrderState } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import { TMA_CARD_SALE_ROUTING_CUTOFF_MS } from 'src/shared/constants'
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
 * **It also closes the terminal before the window does.** Expiry and routing
 * are both Transacto's decisions on Transacto's clock, and nothing orders them:
 * the instant an order stops being open, the credential has room for another
 * and may be given one in the same second — before any sweep has seen the first
 * expire. Two unanswered orders on one sale turns "did the ₴1 428 arrive?" into
 * "did some money arrive?", which nobody can answer. So routing is stood down
 * while the order is still alive; see `TMA_CARD_SALE_ROUTING_CUTOFF_MS`.
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
      // Everything already past its deadline, **and** everything about to be.
      // The second group is why the query reaches into the future at all.
      const sales = await this.saleDbService.findCardOrdersDueBy(
        new Date(now.getTime() + TMA_CARD_SALE_ROUTING_CUTOFF_MS)
      )
      if (sales.length === 0) return

      for (const sale of sales) {
        // One failure must not strand every other sale waiting behind it.
        try {
          await this.answerForOrders(sale, now)
        } catch (error: unknown) {
          this.logger.error(
            `Could not answer for the unanswered orders on sale ${sale.publicId}: ` +
              describeError(error)
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
   * Answers for every order on one sale that the seller has not.
   *
   * Two things, and the clock decides which each order gets. Past its deadline
   * it becomes a dispute, exactly as before. Merely *close* to its deadline it
   * is left alone and the terminal is shut instead — the seller still has the
   * rest of their window, and nobody new can be routed into it.
   *
   * A loop rather than a single lookup even though the credential is capped at
   * one open order, because that cap is Transacto's to enforce and this sweep
   * is not the place to discover it has slipped. Each order is answered on its
   * own; the first dispute stops routing, and the rest are no-ops on a terminal
   * that is already stopped.
   */
  private async answerForOrders(
    sale: Awaited<ReturnType<TmaSaleDbService['findCardOrdersDueBy']>>[number],
    now: Date
  ): Promise<void> {
    const unanswered = (sale.cardOrders ?? []).filter(
      (order) => order.state === SaleCardOrderState.AWAITING_CONFIRMATION
    )

    const overdue = unanswered.filter((order) => order.confirmDeadlineAt <= now)

    // Still alive, and near enough the end that the next payer must not be let
    // in. Only worth doing while nothing is overdue: a dispute stops routing by
    // itself, so doing both would be the same call twice.
    if (overdue.length === 0) {
      if (unanswered.length > 0) await this.cardOrders.holdRouting(sale)

      return
    }

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
