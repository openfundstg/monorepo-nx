import type { TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import type { ParsedStatement } from 'src/shared/interfaces'

/**
 * How much earlier than we heard of an order its money may already have landed.
 *
 * **An order exists upstream before this process knows it does.** Transacto
 * creates it and routes a payer to it; we learn of it from an `order.created`
 * webhook, or — when that does not land — from a sweep that runs every thirty
 * seconds. The payer is paying on Transacto's clock the whole time.
 *
 * So `arrivedAt` is when we found out, not when the order began, and a window
 * starting there excludes money that arrived in the gap. It did: a ₴300 credit
 * timed 18:14:20 against an order recorded at 18:14:04 was reported as no
 * credit at all, because the row had also been rounded back to its minute.
 *
 * Two minutes covers a missed sweep tick and clock skew between the two
 * machines with room to spare.
 *
 * **It used to say here that it could not reach into a neighbouring order's
 * window, and that was simply wrong.** The allowance is the whole boundary
 * between two windows, so where orders arrive closer together than it is — and
 * they do, a card sale's orders are routinely a minute apart — each window
 * opened *before* the previous order's own money had landed, and the entire
 * partition sat one order too early. See {@link boundaryBefore}, which is what
 * now stops that.
 */
const DISCOVERY_ALLOWANCE_MS = 2 * 60 * 1000

/**
 * The earliest moment an order can have existed, which is the boundary between
 * it and the order before it.
 *
 * **One expression for both edges, and that is what makes the partition hold.**
 * This order's window opens here and the previous one's closes a millisecond
 * earlier, so the two share a single definition rather than each computing its
 * own idea of where they meet. Two definitions overlap the moment they
 * disagree, and an overlap attributes one credit to two orders.
 *
 * Two lower bounds, and the later of them wins because both are true:
 *
 * - **`arrivedAt` less the discovery allowance.** The order existed upstream
 *   before this process heard of it, so its money may have landed first.
 * - **When the previous order was answered.** A card sale's credential carries
 *   `max_open_orders: 1`, so the next order was not routed until this one had
 *   been answered — and that is a timestamp this process wrote down, not an
 *   allowance somebody guessed.
 *
 * Taking only the first is what went wrong. Three orders of one sale arrived 90
 * and 60 seconds apart, so a two-minute allowance handed each order the minute
 * the *previous* payer had been paying in: the first order's credit was the only
 * one attributed correctly, the second's window held nothing at all, and the
 * third's held two credits and therefore matched neither. The statement showed
 * all three payments plainly.
 *
 * The residue is sub-second and in the harmless direction: `answeredAt` is
 * recorded just after the upstream call that closes the order, so Transacto may
 * route the next payer a few hundred milliseconds before it. A payment cannot
 * be made inside that sliver, and a credit landing early is capped at the
 * order's own amount by {@link statementCorrection}.
 *
 * `answeredAt` is `null` on an order nobody answered — cancelled, expired. A
 * next order can only exist once this one was closed some other way, so there
 * is no timestamp to bound with and the allowance stands alone.
 */
const boundaryBefore = (
  previous: TmaSaleCardOrder | undefined,
  order: TmaSaleCardOrder
): Date => {
  const discovered = order.arrivedAt.getTime() - DISCOVERY_ALLOWANCE_MS
  const answered = previous?.answeredAt?.getTime()

  return new Date(answered === undefined ? discovered : Math.max(discovered, answered))
}

/**
 * The stretch of time a credit for this order could have landed in.
 *
 * **Bounded on both sides by its neighbours, not only by the clock.** The grace
 * period exists for a bank posting a transfer late, and three hours of it makes
 * consecutive windows overlap — seven orders of one sale are minutes apart, so
 * order one's window would swallow order two's credit and neither could be
 * attributed. A test caught exactly that.
 *
 * Cutting at the next order is sound because a card sale's credential carries
 * `max_open_orders: 1`: order two was not routed until order one had been
 * answered, so money arriving once order two exists is order two's.
 *
 * **Both edges come from {@link boundaryBefore}**, which is why this needs the
 * order before as well as the one after. This window opens at its own boundary
 * and closes a millisecond before the next one's, so consecutive windows
 * partition the time between them with no gap and no overlap — by sharing one
 * definition of where they meet rather than by two calls happening to agree.
 */
export const attributionWindow = (
  previous: TmaSaleCardOrder | undefined,
  order: TmaSaleCardOrder,
  next: TmaSaleCardOrder | undefined,
  graceMs: number
): { from: Date; to: Date } => {
  const from = boundaryBefore(previous, order)
  const lateAllowance = new Date(order.confirmDeadlineAt.getTime() + graceMs)
  const nextBoundary = next === undefined ? null : boundaryBefore(order, next)

  const to =
    nextBoundary !== null && nextBoundary < lateAllowance
      ? new Date(nextBoundary.getTime() - 1)
      : lateAllowance

  // A window cut back past its own start carries nothing, which is the honest
  // answer for two orders recorded within seconds of each other: nothing can be
  // attributed to the first, and the claim is reported rather than guessed at.
  return { from, to: to < from ? from : to }
}

/**
 * How far a document has to reach before its silence about a window means
 * anything.
 *
 * **The window's own upper edge is the wrong answer, because it is usually in
 * the future.** It runs to the payment deadline plus a grace for a bank posting
 * late, and a seller is asked for a statement the moment the deadline passes —
 * so the edge is hours ahead of them, and no document covers time that has not
 * happened.
 *
 * It broke where the grace crossed midnight. A bank issues whole days, so a
 * same-day statement reaches 23:59:59 and stops; an order whose deadline fell
 * after 21:00 Kyiv had a window ending the next day, and **every statement the
 * seller could produce was refused as too short** — complete, correct, every row
 * read, and it proved nothing. Three hours out of every twenty-four.
 *
 * Cutting the requirement at the present is safe in the one direction that
 * matters. Finding a credit executes the order and spends the seller's stake; a
 * document reaching less far can only find fewer credits, never more. Not
 * finding one leaves the dispute with an operator, which is where it already
 * was.
 */
export const coverageRequiredTo = (window: { readonly to: Date }, now: Date): Date =>
  window.to < now ? window.to : now

/** A claim the document contradicts outright, rather than merely corrects. */
export interface UnsettledClaim {
  readonly orderId: number
  /** What the seller said arrived, in UAH kopecks. */
  readonly declaredKopecks: number
}

/** One order's figure, as the seller gave it and as the bank shows it. */
export interface OrderCorrection {
  readonly orderId: number
  /** What the seller said arrived, in UAH kopecks. */
  readonly declaredKopecks: number
  /** What the document shows for its window, capped at what was routed. */
  readonly provenKopecks: number
}

/** What a statement changes about a sale's figures. */
export interface StatementCorrection {
  /**
   * UAH kopecks the bank shows above what the seller claimed, summed across the
   * orders this document reaches. Never negative — see the note below.
   */
  readonly correctionKopecks: number
  /**
   * The same thing order by order, for the two places that need to name one.
   *
   * The sum above moves the sale's total; these move the rows the seller is
   * looking at and write the entry that says which document did it. Only orders
   * the document actually corrected are here — an order it agreed with is not a
   * correction and has nothing to show.
   */
  readonly corrected: readonly OrderCorrection[]
  /**
   * Claims the document shows nothing at all for.
   *
   * Worse than a shortfall and not correctable: the seller confirmed a payment,
   * their USDT was released against it, and the bank's own record of the window
   * holds no credit whatsoever. Nothing is deducted here — a correction moves a
   * figure, and this needs a person.
   *
   * **Credited orders only**, for exactly that reason. A disputed order the
   * document is silent about is the ordinary way a denial is upheld — nobody's
   * USDT went out against it — and reporting that as an unsettled claim raised
   * an operator alarm about an order working precisely as designed.
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
 * Only a *credited* claim can be corrected, and only upwards:
 *
 * - A seller who declared the whole order claimed nothing to check.
 * - A seller whose claim was never credited has nothing here to correct. Their
 *   order was disputed rather than executed, `receivedAmount` holds none of it,
 *   and the finding this same document produces is what settles it — see the
 *   `counted` check below, which is the whole of the fix for sale 13D4L8YJ.
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
  graceMs: number,
  /**
   * The orders already inside `receivedAmount` — the sale's own
   * `creditedOrderIds`.
   *
   * **Required, and not defaulted to "all of them".** A default would make
   * every existing call site keep the behaviour this parameter exists to end,
   * which is the one thing worse than not having it.
   */
  creditedOrderIds: readonly number[]
): StatementCorrection => {
  const unsettled: UnsettledClaim[] = []
  const corrected: OrderCorrection[] = []
  const counted = new Set(creditedOrderIds)
  // Oldest first, so each order's window can be cut at the next one's arrival.
  const ordered = [...cardOrders].toSorted(
    (left, right) => left.arrivedAt.getTime() - right.arrivedAt.getTime()
  )

  const correctionKopecks = ordered.reduce((total, order, index) => {
    const declared = order.declaredAmount
    if (typeof declared !== 'number') return total

    // **A correction moves a figure that is already in the total, and an order
    // nothing has credited has no such figure.** A seller who declares far
    // enough short is not executed at all — `SaleCardOrderService.confirm`
    // disputes the order and credits nothing — yet the claim is still written
    // down, so this reduce used to read `declared` as though `receivedAmount`
    // held it. It did not, and the finding then credited the order in full a
    // moment later: on sale 13D4L8YJ a ₴301 order the seller had declared at
    // ₴101 went in as ₴501, the sale read ₴801 of ₴960 against ₴601 really
    // received, and it closed on a ₴159 tail an operator transferred by hand
    // where ₴359 was still routable.
    //
    // Such an order is left entirely alone here — no correction, no
    // `provenAmount`, no unsettled claim. It is not this document's to settle:
    // `confirmFromStatement` or `upholdDenial` answers it on the same
    // statement, and whichever wins writes the whole of the figure.
    if (!counted.has(order.orderId)) return total

    const { from, to } = attributionWindow(
      ordered[index - 1],
      order,
      ordered[index + 1],
      graceMs
    )

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

    // **Corrected from what is credited now, not from what the seller said.**
    // A second document reaching over the same window recomputes the same
    // figure, and measuring against the original claim every time would credit
    // the same hryvnia twice — a real path, because a later dispute takes a
    // wider statement with it. `provenAmount` is what the last document moved
    // this order to, so a stronger one adds only the difference and an
    // identical one adds nothing.
    const credited = order.provenAmount ?? declared

    if (attributable <= credited) return total

    // The seller's own figure on the entry, whatever it has since been
    // corrected to: the sentence is about what they told us, and "₴300 instead
    // of ₴299.50" would be reporting our own arithmetic back at them.
    corrected.push({
      orderId: order.orderId,
      declaredKopecks: declared,
      provenKopecks: attributable
    })

    return total + (attributable - credited)
  }, 0)

  return { correctionKopecks, corrected, unsettled }
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

  return index < 0
    ? null
    : attributionWindow(ordered[index - 1], ordered[index], ordered[index + 1], graceMs)
}
