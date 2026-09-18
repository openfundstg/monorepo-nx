import type { TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import type { ParsedStatement } from 'src/shared/interfaces'

/**
 * The stretch of time a credit for this order could have landed in.
 *
 * **Bounded by the next order, not only by the grace period.** The grace exists
 * for a bank posting a transfer late, and three hours of it makes consecutive
 * windows overlap — seven orders of one sale are minutes apart, so order one's
 * window would swallow order two's credit and neither could be attributed.
 * A test caught exactly that.
 *
 * The cut is sound because a card sale's credential carries
 * `max_open_orders: 1`: order two was not routed until order one had been
 * answered, so money arriving after order two exists is order two's. Where that
 * makes a window shorter than the order itself — two orders answered inside a
 * minute — the window collapses to the order's own span, which attributes
 * nothing and is reported rather than guessed at.
 */
export const attributionWindow = (
  order: TmaSaleCardOrder,
  next: TmaSaleCardOrder | undefined,
  graceMs: number
): { from: Date; to: Date } => {
  const lateAllowance = new Date(order.confirmDeadlineAt.getTime() + graceMs)
  const to =
    next && next.arrivedAt < lateAllowance ? new Date(next.arrivedAt.getTime() - 1) : lateAllowance

  return { from: order.arrivedAt, to }
}

/** A claim the document contradicts outright, rather than merely corrects. */
export interface UnsettledClaim {
  readonly orderId: number
  /** What the seller said arrived, in UAH kopecks. */
  readonly declaredKopecks: number
}

/** What a statement changes about a sale's figures. */
export interface StatementCorrection {
  /**
   * UAH kopecks the bank shows above what the seller claimed, summed across the
   * orders this document reaches. Never negative — see the note below.
   */
  readonly correctionKopecks: number
  /**
   * Claims the document shows nothing at all for.
   *
   * Worse than a shortfall and not correctable: the seller confirmed a payment,
   * their USDT was released against it, and the bank's own record of the window
   * holds no credit whatsoever. Nothing is deducted here — a correction moves a
   * figure, and this needs a person.
   */
  readonly unsettled: readonly UnsettledClaim[]
}

/**
 * What a bank statement says about the claims a seller made.
 *
 * **A statement is a checkpoint, not an answer about one payment.** It covers a
 * period, and every card order answered inside that period has now been read
 * against the bank's own record — so all of them are settled by one document,
 * including the ones it was not uploaded for.
 *
 * Only a *claim* can be corrected, and only upwards:
 *
 * - A seller who declared the whole order claimed nothing to check.
 * - A seller who declared less than the bank shows kept the difference, and it
 *   goes back onto the target. This is the one claim on a card sale they gain by
 *   making — ₴5 understated leaves ₴5 more outstanding, which brings another
 *   order and more hryvnia for the same stake.
 * - The bank showing *less* than they claimed needs no correction at all.
 *   Understating what you received costs only yourself, and a sale is not in the
 *   business of correcting a user's figures in its own favour.
 *
 * **The credits in a window are summed, not counted.** One Transacto order can
 * be paid by several transfers — ₴400 and ₴600 against a ₴1 000 order is an
 * ordinary way for it to arrive — so what landed for an order is the total of
 * the credits in its window, and an earlier version of this that insisted on
 * exactly one credit would have refused to settle most real sales.
 *
 * A window with no credit at all is not a shortfall to correct. The seller
 * confirmed a payment and their USDT went out against it, and the bank shows
 * nothing: that comes back as an {@link UnsettledClaim} for a person to look at.
 *
 * Pure, and separate from the service, because this is the arithmetic that
 * decides how much of somebody's money is released — the part that has to be
 * testable without eight mocks around it.
 */
export const statementCorrection = (
  cardOrders: readonly TmaSaleCardOrder[],
  statement: ParsedStatement,
  graceMs: number
): StatementCorrection => {
  const unsettled: UnsettledClaim[] = []
  // Oldest first, so each order's window can be cut at the next one's arrival.
  const ordered = [...cardOrders].toSorted(
    (left, right) => left.arrivedAt.getTime() - right.arrivedAt.getTime()
  )

  const correctionKopecks = ordered.reduce((total, order, index) => {
    const declared = order.declaredAmount
    if (typeof declared !== 'number') return total

    const { from, to } = attributionWindow(order, ordered[index + 1], graceMs)

    // Outside what this document can speak for. Not an unsettled claim: the
    // statement simply does not reach it, and a later one may.
    if (from < statement.periodFrom || to > statement.periodTo) return total

    // Summed, because one order can be paid by several transfers.
    const shown = statement.movements.reduce(
      (sum, movement) =>
        movement.amountKopecks > 0 && movement.at >= from && movement.at <= to
          ? sum + movement.amountKopecks
          : sum,
      0
    )

    if (shown === 0) {
      unsettled.push({ orderId: order.orderId, declaredKopecks: declared })

      return total
    }

    // **Never more than the order was for.** Summing the window buys split
    // payments and gives up the old "two credits mean I cannot tell" guard, so
    // an unrelated transfer landing in the window now adds to the total instead
    // of being flagged. Capping here is what keeps that harmless: a correction
    // can bring an order up to what Transacto routed and no further, whatever
    // else happened to that card in those minutes.
    const attributable = Math.min(shown, order.amount)

    return attributable > declared ? total + (attributable - declared) : total
  }, 0)

  return { correctionKopecks, unsettled }
}

/**
 * The same window, for one order named by id.
 *
 * The dispute check asks about a single order and needs the identical bounds —
 * it searches for that order's amount, and two orders of a sale are routinely
 * the same size, so an overlapping window could find a neighbour's credit and
 * report a payment as arrived that never did. That is the dangerous direction.
 */
export const windowForOrder = (
  cardOrders: readonly TmaSaleCardOrder[],
  orderId: number,
  graceMs: number
): { from: Date; to: Date } | null => {
  const ordered = [...cardOrders].toSorted(
    (left, right) => left.arrivedAt.getTime() - right.arrivedAt.getTime()
  )
  const index = ordered.findIndex((order) => order.orderId === orderId)

  return index < 0 ? null : attributionWindow(ordered[index], ordered[index + 1], graceMs)
}
