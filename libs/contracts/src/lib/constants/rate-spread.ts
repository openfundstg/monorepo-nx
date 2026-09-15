/**
 * The two rates this product quotes, and the only two that exist anywhere in it.
 *
 * Everything a user is ever offered is one of these:
 *
 * - **{@link buyRate}** — hryvnia per USDT when they are *acquiring* USDT here.
 *   Below the market, so fewer hryvnia buy one USDT and the user ends up with
 *   more of it. This is the channel that earns the business anything: a user
 *   topping up in hryvnia settles a payout out of Transacto's book in their own
 *   name, and Transacto pays us for clearing it.
 * - **{@link sellRate}** — hryvnia per USDT when they are *selling* it. Above
 *   the market, so one USDT fetches more hryvnia.
 *
 * **There is no third rate, and the market rate is not one.** It is the input
 * these two are derived from, it is never quoted, never stored on a record and
 * never sent over the wire. That is not tidiness: a market figure on a screen
 * beside these two is a price the user can read, and the moment anything
 * compares against it or converts with it, there are three answers to what a
 * hryvnia is worth and no way to tell which one a given row was written with.
 *
 * The percentages live here and nowhere else — not in an environment variable,
 * not in a database column, not on a client. A client that knew the markup
 * could derive its own rate, which is precisely the second answer this file
 * exists to prevent; clients receive the two finished numbers from
 * `GET /tma/rates` and quote them verbatim.
 */

/** Divisor turning a percent into a ratio. */
const PERCENT_BASE = 100;

/**
 * How far below the market USDT is sold to a user, in percent.
 *
 * A percent rather than a fixed number of kopecks: the rate moves several
 * percent a month, and a hand-set spread would be a different discount every
 * time it did.
 */
export const BUY_DISCOUNT_PERCENT = 0.5;

/**
 * How far above the market USDT is bought back from a user, in percent.
 *
 * It used to be `PROFIT_RATE_PERCENT` in the API's environment, which is how it
 * came to be published to clients: a value only the server knew had to be sent
 * to anything that wanted to price a sale. Sending the finished rate instead
 * removes both the variable and the reason it travelled.
 */
export const SELL_MARKUP_PERCENT = 2;

/**
 * Kopecks per USDT for a user acquiring USDT — the market, less the discount.
 *
 * Rounded **down**, so the discount is never quietly smaller than the one
 * advertised: the fraction of a kopeck goes the user's way.
 *
 * Getting the direction backwards is the one mistake here that reaches
 * somebody's money, and it does so silently — 46.73 and 46.27 look equally
 * plausible beside a market of 46.50. Hence {@link isSpreadOrdered}, which
 * every test of these two asserts.
 *
 * A non-positive market rate yields zero rather than a negative: callers render
 * this before the market has answered, and zero is what every screen already
 * reads as "not known".
 */
export const buyRate = (marketRateKopecksPerUsdt: number): number => {
  if (marketRateKopecksPerUsdt <= 0) return 0;

  return Math.floor(marketRateKopecksPerUsdt * (1 - BUY_DISCOUNT_PERCENT / PERCENT_BASE));
};

/**
 * Kopecks per USDT for a user selling USDT — the market, plus the markup.
 *
 * Rounded **up**, for the mirror of {@link buyRate}'s reason: the markup is
 * never quietly smaller than the one advertised.
 *
 * This replaced a profit *added to the target*. A sale used to be quoted at the
 * market and then have a percentage put on top as a separate figure the user
 * was told about. The arithmetic is identical to the kopeck — a target 2% above
 * the market equivalent is a target priced at a rate 2% above the market — but
 * one number a user can compare beats two they have to add up, and it is the
 * number every other price in this product is expressed as.
 */
export const sellRate = (marketRateKopecksPerUsdt: number): number => {
  if (marketRateKopecksPerUsdt <= 0) return 0;

  return Math.ceil(marketRateKopecksPerUsdt * (1 + SELL_MARKUP_PERCENT / PERCENT_BASE));
};

/**
 * What a round trip through both rates earns, in percent.
 *
 * Hryvnia in at {@link buyRate}, USDT out at {@link sellRate}: the user ends up
 * with more hryvnia than they started with, and this is how much more. It is
 * the product's whole proposition in one number, and the dashboard states it.
 *
 * Computed from the two rates rather than added up from the two percentages —
 * `0.5 + 2` is not the answer (it is 2.51% at these figures, because the second
 * leg compounds on the first), and more importantly a screen that adds
 * percentages is a screen that knows what they are. Nothing outside this file
 * should.
 *
 * Zero when either rate is unknown, which is what every screen renders as "not
 * known" rather than as a promise of nothing.
 */
export const roundTripProfitPercent = (buy: number, sell: number): number => {
  if (buy <= 0 || sell <= 0) return 0;

  return (sell / buy - 1) * PERCENT_BASE;
};

/**
 * What a round trip earns on one USDT, in kopecks.
 *
 * The same fact as {@link roundTripProfitPercent} in the unit a user actually
 * holds. A percentage is the honest way to compare two rates and a poor way to
 * picture one: `+2.5%` is an abstraction, `+1.15 ₴ per USDT` is the difference
 * between the two numbers printed directly above it, and the reader can check
 * it by subtracting.
 *
 * Zero when either rate is unknown — the same "not known" every screen renders
 * as absent rather than as nothing gained.
 */
export const roundTripProfitKopecks = (buy: number, sell: number): number => {
  if (buy <= 0 || sell <= 0) return 0;

  return sell - buy;
};

/**
 * Whether the two rates are the right way round, for the tests that say so.
 *
 * The buy rate must be the smaller number and the sell rate the larger. Every
 * screen, every settlement and the entire proposition depend on it, and nothing
 * about the two figures makes it obvious at a glance.
 */
export const isSpreadOrdered = (buy: number, sell: number): boolean => buy > 0 && sell > buy;
