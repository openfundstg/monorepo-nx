/**
 * The two prices this app quotes, held in one place and refreshed on one timer.
 *
 * There are two, and there is no third. `buy` is what a user pays per USDT when
 * acquiring it here; `sell` is what they get per USDT when selling it. The
 * market rate they are derived from is not among them and never reaches this
 * app — a figure a screen can read is a figure a screen can quote, and then
 * there are three answers to what a hryvnia is worth.
 *
 * They used to be fetched per screen: the dashboard held a service with its own
 * TTL, the top-up list read a third figure out of its options response, and
 * each re-read on its own schedule. Nothing was *wrong* with any single copy;
 * what was wrong is that two screens open a minute apart quoted different
 * prices for the same USDT, which reads as the app not knowing what it charges.
 *
 * **Not for pricing anything.** A screen that freezes a stake or credits a
 * deposit must take its rate from the same response as the balance and limits
 * it is quoting against — `/sales/config` and `/deposits/config` return
 * all of it together for exactly that reason. Reading a polled figure there
 * would let the quote and the amount disagree.
 *
 * `null` means "not known", which is different from zero: a screen must render
 * it as absent rather than as a free hryvnia.
 */
export interface RatesState {
  /** Kopecks per USDT when acquiring USDT — always the smaller of the two. */
  readonly buy: number | null
  /** Kopecks per USDT when selling USDT — always the larger of the two. */
  readonly sell: number | null
}

export const RATES_FEATURE = 'rates'

export const initialRatesState: RatesState = {
  buy: null,
  sell: null
}
