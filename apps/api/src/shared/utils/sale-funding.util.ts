import {
  CentRounding,
  SaleRemainderPolicy,
  TmaSaleStatus,
  usdtCentsForKopecks
} from '@transacto/contracts'

/** The three figures the funding rule is decided on. */
export interface SaleFunding {
  /** The target, in UAH kopecks. */
  readonly fiatAmount: number
  /** Matched and executed orders so far, in UAH kopecks. */
  readonly receivedAmount?: number | null
  /** Last scraped jar balance, in UAH kopecks; `null` means never scraped. */
  readonly jarBalance?: number | null
}

/**
 * Whether this order has been funded to its target and should close.
 *
 * Two ways in, and the second is bounded by `minOrderKopecks`:
 *
 * 1. Executed orders cover the target. Anything at or over the figure closes
 *    it — an overshoot is still a fully funded order, not a reason to wait.
 * 2. The jar itself holds the target, and what no order accounts for is smaller
 *    than one order could ever have been. This is the trader's manual top-up:
 *    it is the only thing that could have filled that gap, because Transacto
 *    could not have routed an order that size.
 *
 * A jar that has never been scraped reads as empty, which only ever withholds
 * completion — never grants it.
 */
export const isSaleFunded = (
  order: SaleFunding,
  minOrderKopecks: number
): boolean => {
  const received = order.receivedAmount ?? 0
  if (received >= order.fiatAmount) return true

  const balance = order.jarBalance ?? 0
  if (balance < order.fiatAmount) return false

  return order.fiatAmount - received <= minOrderKopecks
}

/** What a refund is measured against. */
export interface SaleDelivery {
  /** Matched and executed orders so far, in UAH kopecks. */
  readonly receivedAmount?: number | null
  /** Last scraped jar balance, in UAH kopecks; `null` means never scraped. */
  readonly jarBalance?: number | null
  /** The jar's balance when this order started; `null` means never scraped. */
  readonly openingJarBalance?: number | null
}

/**
 * UAH kopecks this order has actually put in the user's hands.
 *
 * `receivedAmount` alone is not that figure, and a refund computed from it
 * gave back the whole stake while hryvnia sat in the user's jar. It counts
 * only money matched to a settled Transacto order, and the jar can hold money
 * no order accounts for — an unrecognised or ambiguous deposit the matcher
 * could not attribute, or a payment that landed without an order behind it.
 * {@link isSaleFunded} already had to reckon with the same gap to
 * decide completion; a cancellation has to reckon with it to decide a refund.
 *
 * The jar's own growth is the other measure, and it is growth rather than the
 * raw balance on purpose: a user who pointed the order at a jar that already
 * held money must not be charged USDT for hryvnia that was theirs before any
 * of this started. Where the opening balance was never scraped the jar side
 * is not counted at all — an unknown baseline may not become a charge.
 *
 * The greater of the two wins. They measure the same thing by different
 * routes, and the larger is the one that money demonstrably reached.
 */
export const saleDeliveredFiat = (order: SaleDelivery): number => {
  const matched = Math.max(0, order.receivedAmount ?? 0)

  const balance = order.jarBalance
  const opening = order.openingJarBalance
  const grown =
    typeof balance === 'number' && typeof opening === 'number' ? Math.max(0, balance - opening) : 0

  return Math.max(matched, grown)
}

/** What the goal check is decided on, seen from the terminal rather than the order. */
export interface JarGoalProgress {
  /** The jar's target in UAH kopecks; `null`/absent when the bank reports none. */
  readonly goal?: number | null
  /** The jar's balance right now, in UAH kopecks. */
  readonly balance: number
  /** How much of that balance no pending order accounts for. */
  readonly unmatched: number
}

/**
 * Whether an unmatched deposit is the trader closing the last stretch to the goal.
 *
 * This is {@link isSaleFunded}'s second route, stated from the scraper's
 * side, and the two are deliberately the same rule: the jar holds its target,
 * and what no order accounts for is smaller than one order could ever have
 * been. Transacto cannot route an order that small, so nothing else could have
 * put it there.
 *
 * It exists because the two readings used to disagree at exactly the moment
 * they mattered. `TERMINAL_FULL_WARNING` tells the trader to pay in the
 * remainder by hand; they do; and the scraper then saw a deposit matching no
 * pending order and filed it as `UNRECOGNIZED_DEPOSIT` — raising a second alert
 * for the very action the first one asked for, while the jar sat full and the
 * sale stayed open.
 *
 * A jar with no goal, or one still short of it, is never this: those really are
 * deposits nobody can account for.
 */
export const isGoalClosingTopUp = (progress: JarGoalProgress, minOrderKopecks: number): boolean => {
  const { goal, balance, unmatched } = progress

  if (typeof goal !== 'number' || goal <= 0) return false
  if (balance < goal) return false

  return unmatched > 0 && unmatched <= minOrderKopecks
}

/** What the remainder rule is decided on. */
export interface SaleTail extends SaleDelivery {
  /** The target, in UAH kopecks. */
  readonly fiatAmount: number
  /** Absent on orders stored before the choice existed — read as the default. */
  readonly remainderPolicy?: SaleRemainderPolicy | null
}

/**
 * Whether what is left of this order can no longer arrive, and should be
 * refunded instead.
 *
 * The tail exists because the payment pipeline has a floor. Transacto will not
 * route an order below `minOrderKopecks`, and a terminal's turnover is capped
 * at exactly the order's target — so once the gap is smaller than that floor,
 * nothing can fill it. Today somebody pays it in by hand; an order created with
 * {@link SaleRemainderPolicy.REFUND_TO_BALANCE} gets the gap back as
 * USDT instead and closes successfully.
 *
 * **Strictly below the floor, where {@link isSaleFunded} allows equal.**
 * The two are asking different questions and the comparison follows the
 * question. There, money has already arrived and the gap is between what was
 * matched and what the jar holds — a gap of exactly the floor is still money in
 * the jar. Here the gap is money that has *not* arrived, and an order of
 * exactly `minOrderKopecks` is one the pipeline can still route: refunding at
 * that point would give up on a payment that was still coming.
 *
 * Nothing having arrived yet is not a tail. `delivered <= 0` means the order has
 * not started, and an order whose whole target happens to sit below the floor
 * would otherwise refund itself the instant it was created.
 */
export const isRemainderRefundable = (order: SaleTail, minOrderKopecks: number): boolean => {
  if (
    (order.remainderPolicy ?? SaleRemainderPolicy.WAIT_FOR_TOP_UP) !==
    SaleRemainderPolicy.REFUND_TO_BALANCE
  )
    return false

  const delivered = saleDeliveredFiat(order)
  if (delivered <= 0) return false

  const remainder = order.fiatAmount - delivered
  if (remainder <= 0) return false

  return remainder < minOrderKopecks
}

/** How a completed order's frozen stake is split, and what it counts as sold. */
export interface SaleSettlement {
  /**
   * UAH kopecks this order actually sold — what turnover and the referral
   * cut are measured on, and the figure the COMPLETED event carries.
   */
  readonly settledFiat: number
  /** UAH kopecks of the target that no payment covered. Zero on a full fill. */
  readonly remainderKopecks: number
  /** USDT cents going back to the spendable balance. */
  readonly refundedUsdtCents: number
  /** USDT cents leaving the frozen pot for good — it bought the fiat delivered. */
  readonly committedUsdtCents: number
}

/** Everything the settlement is computed from. */
export interface SettleableSale extends SaleTail {
  /** USDT cents frozen for this order. */
  readonly frozenUsdt: number
  /** Kopecks per USDT, snapshotted at creation. */
  readonly exchangeRate: number
}

/**
 * Splits a completing order's stake, and says how much it really sold.
 *
 * **A `WAIT_FOR_TOP_UP` order settles exactly as it always did** — the whole
 * stake is committed and the whole target counts as sold — and that branch
 * is deliberately not routed through the arithmetic below. Such an order only
 * completes once it is funded, so the two agree in every real case; but the
 * jar-growth half of {@link saleDeliveredFiat} reads zero when
 * `openingJarBalance` was never scraped, and an order stored before that field
 * existed would otherwise have its turnover quietly reduced on completion.
 *
 * For a `REFUND_TO_BALANCE` order the delivered figure is the whole point.
 * Turnover, the referral cut and the COMPLETED event all move to what actually
 * arrived, because crediting the full target for hryvnia nobody ever paid would
 * inflate the trust ladder and pay a referrer for money that does not exist.
 *
 * The conversion is {@link usdtCentsForKopecks} at the order's own rate — the
 * same call the cancellation path makes, so the two cannot come to disagree
 * about what a hryvnia of this order is worth in USDT.
 *
 * Clamped to the frozen amount: a jar reporting less than it should must not
 * produce a refund larger than the stake it is refunding out of.
 */
export const settleSale = (order: SettleableSale): SaleSettlement => {
  const policy = order.remainderPolicy ?? SaleRemainderPolicy.WAIT_FOR_TOP_UP

  if (policy !== SaleRemainderPolicy.REFUND_TO_BALANCE) {
    return {
      settledFiat: order.fiatAmount,
      remainderKopecks: 0,
      refundedUsdtCents: 0,
      committedUsdtCents: order.frozenUsdt
    }
  }

  const settledFiat = Math.min(order.fiatAmount, Math.max(0, saleDeliveredFiat(order)))
  const remainderKopecks = order.fiatAmount - settledFiat
  // Rounded **up**, and that is the whole of the profit guarantee.
  //
  // The promise is that the user ends up with the full target's worth however
  // the order finishes — hryvnia in the jar plus USDT on the balance. Rounding
  // the refund to nearest broke that by up to half a cent, which is about ₴0.23
  // at ₴46.52 per USDT. On a ₴4 000 order that is noise; on a ₴1 tail it was
  // larger than the profit share inside the tail, and the realised return came
  // out at 1.998% against a quoted 2%. Rounding up costs at most one cent and
  // makes the guarantee exact rather than approximate.
  const refundedUsdtCents = Math.min(
    order.frozenUsdt,
    usdtCentsForKopecks(remainderKopecks, order.exchangeRate, CentRounding.UP)
  )

  return {
    settledFiat,
    remainderKopecks,
    refundedUsdtCents,
    committedUsdtCents: order.frozenUsdt - refundedUsdtCents
  }
}

/** What a stopped order owes back, and what the jar has already eaten. */
export interface SaleRefundSplit {
  /** USDT cents returning to the spendable balance. */
  readonly refunded: number
  /** USDT cents that stay spent, because they paid for hryvnia the user has. */
  readonly consumed: number
}

/**
 * Splits a frozen stake into what goes back and what does not.
 *
 * Lifted out of `SaleCancelService` so the admin panel can show an
 * operator the figure a cancellation *would* pay before they commit to it — and
 * so that preview cannot drift from the settlement, which is the only reason it
 * is worth showing at all.
 *
 * `deliveredFiat` is {@link saleDeliveredFiat}, not `receivedAmount`:
 * hryvnia can reach a jar without a settled order to attribute it to, and
 * refunding that in full hands back money the user still has.
 *
 * Clamped both ways — a jar reporting more than the order was for must not
 * produce a negative refund, and the consumed half can never exceed what was
 * frozen.
 */
export const saleRefundSplit = (order: {
  readonly frozenUsdt: number
  readonly exchangeRate: number
  readonly receivedAmount?: number | null
  readonly jarBalance?: number | null
  readonly openingJarBalance?: number | null
}): SaleRefundSplit => {
  const delivered = saleDeliveredFiat(order)
  const consumed = Math.min(order.frozenUsdt, usdtCentsForKopecks(delivered, order.exchangeRate))

  return { refunded: order.frozenUsdt - consumed, consumed }
}

/** What an ended order took off the balance, and what it handed over for it. */
export interface SaleDisposal {
  /** USDT cents that left the balance for good — the stake, less what came back. */
  readonly committedUsdtCents: number
  /** UAH kopecks the order actually put in the user's hands. */
  readonly deliveredFiat: number
}

/**
 * The two figures an ended order is worth, whichever way it ended.
 *
 * Both endings dispose of USDT and both hand over hryvnia, but they compute
 * each differently, and neither is readable off the document. That is the trap
 * this exists to close: `frozenUsdt - refundedRemainderUsdt` looks like the
 * committed stake and is only that for a **completed** order —
 * `refundedRemainderUsdt` is written by `completeIfOpen` and by nothing else,
 * so on a cancelled one it reads its default of zero and the whole stake looks
 * spent. An order cancelled before anybody paid would report its entire stake
 * sold for nothing.
 *
 * And `receivedAmount` is not the hryvnia either; see
 * {@link saleDeliveredFiat}, which exists because a jar can hold money
 * no settled order accounts for.
 *
 * So each ending is routed to the function that already owns it — completion to
 * {@link settleSale}, cancellation to {@link saleRefundSplit} —
 * and this is the one place a reader has to look to find out which. Every
 * caller that needs "what did this order actually move" gets the same answer as
 * the settlement that moved it, which is the property `saleRefundSplit`
 * was lifted out of the cancel service to protect.
 *
 * Only meaningful for an order that has ended. An open one has disposed of
 * nothing yet, and its stake is still reserved rather than spent.
 */
export const saleDisposal = (
  order: SettleableSale & { readonly status: TmaSaleStatus }
): SaleDisposal => {
  if (order.status === TmaSaleStatus.CANCELLED) {
    return {
      committedUsdtCents: saleRefundSplit(order).consumed,
      deliveredFiat: saleDeliveredFiat(order)
    }
  }

  const settlement = settleSale(order)

  return {
    committedUsdtCents: settlement.committedUsdtCents,
    deliveredFiat: settlement.settledFiat
  }
}

/** The part of a sale that decides whether its claims have been checked. */
export interface SaleClaims {
  readonly statementCheckpointAt?: Date | null
  readonly cardOrders?: readonly {
    readonly declaredAmount?: number
    readonly answeredAt?: Date | null
  }[]
}

/**
 * Whether this sale is holding a claim no statement has been through yet.
 *
 * True when a seller said some payment arrived short and no accepted statement
 * reaches as far as the moment they said it.
 *
 * **What it gates is the tail, and that is the whole design.** A shortfall is
 * the one claim on a card sale a seller profits by making — ₴5 understated is
 * ₴5 more of the target outstanding, another order routed, and more hryvnia for
 * the same stake. Refusing the claim outright would punish every honest seller
 * whose bank took a fee; taking it on trust would pay for every dishonest one.
 *
 * So the claim is taken, the sale runs on, and what is withheld is the
 * remainder at the end — which cannot be collected until a statement says what
 * really landed. A seller who told the truth loses nothing and waits for one
 * document; a seller who did not finds the difference taken out of exactly the
 * money they were trying to keep.
 *
 * Empty on every jar sale: they have no card orders, so nothing is ever
 * claimed and nothing is ever held.
 */
export const awaitsStatementCheckpoint = (sale: SaleClaims): boolean => {
  const checkpoint = sale.statementCheckpointAt ?? null

  return (sale.cardOrders ?? []).some((order) => {
    if (typeof order.declaredAmount !== 'number') return false
    if (checkpoint === null) return true

    // An order answered before the checkpoint has been read; one answered after
    // it — or with no answer time at all — has not.
    return !order.answeredAt || order.answeredAt > checkpoint
  })
}
