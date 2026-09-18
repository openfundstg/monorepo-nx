import { Injectable, Logger } from '@nestjs/common'
import {
  isGoalWithinTolerance,
  KOPECKS_PER_UAH,
  SaleBlockReason
} from '@transacto/contracts'
import { OrderDbService, OrderStatus } from 'src/modules/repositories/order-db'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import type { StoredSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleBlockService } from 'src/modules/telegram-mini-app/services/sale-block.service'

/** A lean order document plus its id. */

/**
 * How many dead orders in a row condemn a terminal.
 *
 * Three, not one: a single payer walking away is ordinary, and two in a row is
 * bad luck. Three consecutive orders producing nothing, on a jar that never
 * received a kopeck, is not luck — it is a terminal nobody can pay into.
 */
const DEAD_ORDER_STREAK = 3

/** Kopecks → whole hryvnia, the unit both sides of the goal check speak. */
const toWholeUah = (kopecks: number): number => Math.round(kopecks / KOPECKS_PER_UAH)

/**
 * Enforces the two rules a sale can break after it is already running.
 *
 * Both are checked from the balance scrape rather than on a timer, because that
 * is the one signal that already fires for every live Mini App terminal and
 * already carries what both rules need — the jar's target and its balance.
 *
 * Every method is silent on failure. These run inside the scraper's event
 * handlers, where throwing would take down a scrape that has nothing to do with
 * this order.
 */
@Injectable()
export class SaleComplianceService {
  private readonly logger = new Logger(SaleComplianceService.name)

  constructor(
    private readonly orderDbService: OrderDbService,
    private readonly blockService: SaleBlockService
  ) {}

  /**
   * Checks both rules against one scrape. Returns `true` if the order was
   * blocked, so the caller can stop treating it as live.
   */
  async check(order: StoredSale, goal: number | undefined, balance: number): Promise<boolean> {
    // An order the user has already asked to end is left alone entirely. Both
    // rules below stop a terminal and freeze the stake, and doing that to an
    // order that is winding down would punish a user for a jar they have
    // already walked away from — while holding the refund they are owed. It
    // stays watched, because a payer holding an outstanding order can still pay.
    if (order.status === TmaSaleStatus.CLOSING) return false

    // Money in the jar, or money already credited, settles it: this terminal
    // demonstrably works, and blocking now would strand the payer's hryvnia
    // *and* the user's frozen USDT with no path to either. Neither rule below
    // is worth that. A jar whose target is wrong simply never fills, and the
    // order expires on its own terms instead.
    if (this.hasMoneyInFlight(order, balance)) return false

    if (await this.checkGoal(order, goal)) return true

    return this.checkDeadOrders(order, balance)
  }

  /** Anything sitting in the jar, or already matched to an order. */
  private hasMoneyInFlight(order: StoredSale, balance: number): boolean {
    return balance > 0 || (order.receivedAmount ?? 0) > 0
  }

  /**
   * The jar's target must equal what the order is for — compared in whole
   * hryvnia, which is the only precision either side can actually express.
   *
   * `fiatAmount` already includes the profit, so it *is* the figure the user was
   * told to set, and it is stored snapped to a whole hryvnia because that is
   * what a bank's goal field accepts.
   *
   * The comparison and its one-hryvnia tolerance live in
   * {@link isGoalWithinTolerance}, shared with the create form and the
   * creation-time check — a client that allowed the gap while this refused it
   * would let a user submit an order that was blocked the moment it started.
   *
   * An open-ended jar — no target at all — still counts as a mismatch: it
   * accepts any amount, which is exactly what the rule exists to prevent.
   */
  private async checkGoal(order: StoredSale, goal: number | undefined): Promise<boolean> {
    // An operator has already looked at this order and put it back to work.
    // Blocking it again on the same reading would make the panel's button a
    // no-op — which is exactly what it was: a resumed order came back blocked
    // on the next scrape, seventeen seconds later, over the same four hryvnia.
    //
    // Only this rule is waived. The dead-order streak below stays on: it is
    // about a card that does not belong to the jar, and nobody can vouch for
    // that by pressing a button.
    if (order.resumedByAdminAt !== null && order.resumedByAdminAt !== undefined) return false

    const observed = typeof goal === 'number' ? goal : null

    // Absence is not a mismatch. `TerminalBalanceUpdatedDto.goal` is documented
    // as omitted when a scrape does not report one, and that says nothing about
    // the jar either way — treating it as "no goal set" blocked orders on a
    // single unlucky reading.
    if (observed === null) return false

    if (isGoalWithinTolerance(observed, order.fiatAmount)) return false

    this.logger.warn(
      `Sale ${order.publicId}: jar target is ${
        observed === null ? 'unset' : `${toWholeUah(observed)} UAH`
      } but the order is for ${toWholeUah(order.fiatAmount)} UAH. Blocking.`
    )

    return this.blockService.block(order, SaleBlockReason.GOAL_MISMATCH, observed)
  }

  /**
   * Three dead orders in a row against an empty jar.
   *
   * The signature of a card number that does not belong to the jar the link
   * points at: Transacto keeps sending payers to a card, the money never lands
   * where we are watching, and every order times out. Both halves are required
   * — a streak on a jar that *has* received money is a payer problem, not a
   * setup problem.
   *
   * Skipped entirely when the bank named the card, since then the premise of
   * the rule is false by construction.
   *
   * `OrderStatus.CANCELLED` is the local bucket every dead upstream status
   * collapses into: expired, overdue, declined, client-cancelled and the rest.
   */
  private async checkDeadOrders(order: StoredSale, balance: number): Promise<boolean> {
    // The rule catches one thing: a card that does not belong to the jar the
    // link points at. When the bank named the card itself — PrivatBank's
    // envelope record does — that cannot be what happened, so a streak of dead
    // orders here is payers walking away, and blocking would freeze a correctly
    // set-up user's stake for something nobody did wrong.
    //
    // Read off the order rather than off its bank, because the fact is
    // per-order: what matters is that this link actually disclosed a card, not
    // that its bank usually would.
    if (order.cardVerifiedByBank) return false

    if (balance !== 0) return false
    if (order.cardId === null) return false
    // Money has reached this terminal before, so its wiring is demonstrably
    // fine and a run of failures is somebody else's doing.
    if ((order.receivedAmount ?? 0) > 0) return false

    const recent = await this.orderDbService.findRecentByCard(order.cardId, DEAD_ORDER_STREAK)
    if (recent.length < DEAD_ORDER_STREAK) return false
    if (!recent.every((candidate) => candidate.status === OrderStatus.CANCELLED)) return false

    this.logger.warn(
      `Sale ${order.publicId}: ${DEAD_ORDER_STREAK} orders in a row expired on card ` +
        `${order.cardId} with an empty jar. Blocking.`
    )

    return this.blockService.block(order, SaleBlockReason.ORDERS_EXPIRED)
  }
}
