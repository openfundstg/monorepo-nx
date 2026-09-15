/**
 * What a user has actually earned here, split by what we can honestly claim.
 *
 * The split is the whole design, and it is a split of *evidence* rather than of
 * product. Every USDT this product sells for somebody came from one of two
 * places, and only one of them tells us what it cost:
 *
 * - **Acquired with hryvnia here.** Both legs are payments we watched: the
 *   hryvnia the user handed over, and the hryvnia their bank received. The
 *   difference is a fact, and {@link IncomeFromFiat.profitUah} states it.
 * - **Brought in from outside** — a TRC20 transfer, a referral payout, an
 *   operator's correction. We know what it fetched and nothing whatever about
 *   what it cost: it was bought on an exchange we cannot see, at a price we
 *   were never told. So {@link IncomeFromOwnUsdt} carries **no profit figure at
 *   all**, only the sale.
 *
 * Blending the two into one number was the tempting option and is the one thing
 * this shape forbids. It would take a valuation — our own buy rate at the
 * moment the USDT arrived — and print it beside a real payment in the same
 * font. Half of that number would be a measurement and half a guess, and
 * nothing on the screen could tell a reader which half was which.
 *
 * **Realised only.** USDT still sitting on the balance appears nowhere here: a
 * figure that moved with the market rather than with anything the user did
 * would change between two glances at a page about what they earned.
 */
export interface IncomeAnalyticsResponse {
  /** Sales of USDT this product sold them for hryvnia. Profit is knowable. */
  fromFiat: IncomeFromFiat;
  /** Sales of USDT they already had. Revenue only — the cost is not ours to state. */
  fromOwnUsdt: IncomeFromOwnUsdt;
}

/**
 * The half of the story with two observed ends.
 *
 * `profitUah` is `receivedUah - spentUah` and is sent rather than left to the
 * client, so the page and the server cannot come to two answers about the same
 * subtraction. It can be negative: a sale settled below what its USDT cost is
 * unusual — the spread is built to prevent it — but it is not impossible, and a
 * page that could not render a loss would be lying by construction.
 */
export interface IncomeFromFiat {
  /** USDT cents sold whose hryvnia cost is known. */
  soldUsdtCents: number;
  /** UAH kopecks actually paid for exactly that USDT. */
  spentUah: number;
  /** UAH kopecks their bank actually received for it. */
  receivedUah: number;
  /** `receivedUah - spentUah`. Signed. */
  profitUah: number;
}

/**
 * The half with one observed end.
 *
 * No `spentUah`, no `profitUah`, and their absence is the point — this
 * interface is where the product declines to guess. What the user gets instead
 * is the two numbers that are theirs to compare against whatever they paid,
 * which only they know.
 */
export interface IncomeFromOwnUsdt {
  /** USDT cents sold, out of USDT this product never sold them. */
  soldUsdtCents: number;
  /** UAH kopecks their bank received for it. */
  receivedUah: number;
  /**
   * Kopecks per USDT, averaged over those sales and weighted by size.
   *
   * The figure a user checks their own purchase price against, so it is
   * computed once on the server: a client dividing the two totals above would
   * be a second implementation of the same average, and the two would disagree
   * the first time either rounded.
   *
   * Zero when nothing has been sold, which every screen already renders as
   * absent rather than as a rate of nought.
   */
  averageSellRate: number;
}
