import { CENTS_PER_USDT, type IncomeAnalyticsResponse } from '@transacto/contracts'

/**
 * One arrival of USDT on a user's balance.
 *
 * `costUah` is the hryvnia they actually handed over for it, or `null` when
 * they did not hand over any that we saw — a TRC20 transfer, a referral payout,
 * an operator's correction. `null` is not "we failed to look it up": it is the
 * statement that no such payment exists, and it is what keeps that USDT out of
 * every profit figure downstream.
 */
export interface UsdtLot {
  /** USDT cents that arrived. */
  readonly usdtCents: number
  /** UAH kopecks paid for exactly those cents, or `null` when nothing was. */
  readonly costUah: number | null
  /** When it arrived. Lots are consumed oldest first. */
  readonly at: Date
}

/**
 * One sale that took USDT off the balance for good.
 *
 * **Not a stake.** Freezing USDT against a sale reserves it; only the
 * committed part ever left, and how much that was depends on how the order
 * ended — which is `saleDisposal`'s job, not this file's. A sale that
 * refunded half its stake disposed of half, and the other half was never gone,
 * which is why refunds need no handling anywhere in here.
 */
export interface UsdtSale {
  /** USDT cents that left the balance for good. */
  readonly usdtCents: number
  /** UAH kopecks the user's bank actually received for them. */
  readonly receivedUah: number
  /**
   * When the USDT was earmarked, which is when the order was created rather
   * than when it settled.
   *
   * The stake was checked against the balance at that moment, so a lot that
   * arrived afterwards cannot have paid for it — ordering by the ending would
   * let a top-up made during a long order fund an order that predated it.
   */
  readonly at: Date
}

/**
 * Matches sold USDT against the lots it came from, oldest lot first.
 *
 * **Why matching at all**, when subtracting two totals looks like it would do:
 * because it would not. Spend ₴1 000, sell nothing, and totals report a ₴1 000
 * loss on a user who has simply not sold yet. Bring 50 USDT in from an exchange
 * and sell it, and totals report the entire proceeds as profit on a purchase
 * that cost us nothing to observe and them a great deal to make. Both are
 * wrong in the direction that matters — one frightens an honest user, the other
 * flatters them — and only pairing each sold cent with the cent that arrived
 * avoids both.
 *
 * FIFO because it is the convention every accounting system and every tax
 * authority already uses, so a user who checks the arithmetic recognises it. No
 * other rule is more correct here — USDT cents are fungible and none of them
 * carries a serial number — so the one worth choosing is the one that needs no
 * explaining.
 *
 * A sale that outruns the lots is possible and is not an error: a user whose
 * history predates this book has USDT nothing here can account for. Those cents
 * are matched as costless, which places them in `fromOwnUsdt` — the bucket that
 * claims no profit — rather than inventing a basis for them.
 *
 * Pure, and over plain numbers: this is the arithmetic the whole page rests on,
 * and it is worth being able to test it without a database.
 */
export const matchSalesToLots = (
  lots: readonly UsdtLot[],
  sales: readonly UsdtSale[]
): IncomeAnalyticsResponse => {
  // `.map` is what protects the caller's array: the working copies below are
  // fresh objects, so draining them touches nothing that was handed in.
  const remaining = lots
    .toSorted(byArrival)
    .map((lot) => ({ ...lot, left: lot.usdtCents }))

  let paidCents = 0
  let paidCostUah = 0
  let paidReceivedUah = 0
  let ownCents = 0
  let ownReceivedUah = 0

  for (const sale of sales.toSorted(byArrival)) {
    let unmatched = sale.usdtCents

    for (const lot of remaining) {
      if (unmatched === 0) break
      // Sorted, so the first lot too late to have funded this sale means every
      // lot after it is too late as well.
      if (lot.at.getTime() > sale.at.getTime()) break
      if (lot.left === 0) continue

      const taken = Math.min(lot.left, unmatched)
      lot.left -= taken
      unmatched -= taken

      // The sale's hryvnia is split across its lots in proportion to the cents
      // each one supplied, because that is the only division that keeps the
      // parts summing to the whole. Its cost comes from the lot at the lot's
      // own rate — the two legs are priced independently, which is precisely
      // what makes their difference the spread.
      const share = shareOf(sale.receivedUah, taken, sale.usdtCents)

      if (lot.costUah === null) {
        ownCents += taken
        ownReceivedUah += share
        continue
      }

      paidCents += taken
      paidCostUah += shareOf(lot.costUah, taken, lot.usdtCents)
      paidReceivedUah += share
    }

    // Sold more than this book can account for. Costless, never guessed at.
    if (unmatched > 0) {
      ownCents += unmatched
      ownReceivedUah += shareOf(sale.receivedUah, unmatched, sale.usdtCents)
    }
  }

  return {
    fromFiat: {
      soldUsdtCents: paidCents,
      spentUah: paidCostUah,
      receivedUah: paidReceivedUah,
      profitUah: paidReceivedUah - paidCostUah
    },
    fromOwnUsdt: {
      soldUsdtCents: ownCents,
      receivedUah: ownReceivedUah,
      averageSellRate: averageRate(ownReceivedUah, ownCents)
    }
  }
}

/** Oldest first, for both streams — the ordering the whole match depends on. */
const byArrival = (left: { at: Date }, right: { at: Date }): number =>
  left.at.getTime() - right.at.getTime()

/**
 * `part / whole` of an amount, in whole kopecks.
 *
 * Rounded, and the residue is accepted: splitting ₴10 across three lots cannot
 * come to ₴10 in whole kopecks however it is done. The error is bounded by one
 * kopeck per lot per sale, which is invisible beside figures in the thousands
 * and is the price of not carrying fractions through a page.
 *
 * A `whole` of zero yields zero rather than a division by it — a sale of no
 * USDT has no share to give, and it is reachable through a document written by
 * a path that failed halfway.
 */
const shareOf = (amount: number, part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((amount * part) / whole)

/**
 * Kopecks per whole USDT, from cents and kopecks.
 *
 * Zero on nothing sold, which every screen already renders as "not known"
 * rather than as a rate of nought.
 */
const averageRate = (receivedUah: number, soldCents: number): number =>
  soldCents === 0 ? 0 : Math.round((receivedUah * CENTS_PER_USDT) / soldCents)
