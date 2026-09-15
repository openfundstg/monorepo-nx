import {
  floorToWholeUah,
  isGoalWithinTolerance,
  KOPECKS_PER_UAH,
  roundToWholeUah,
} from './money.js';

/** USDT cents in one USDT. Balances are held in cents; users type whole USDT. */
export const CENTS_PER_USDT = 100;

/**
 * Everything a sale's money is made of, derived from one target.
 *
 * All figures are integers in their own smallest unit: hryvnia in kopecks,
 * USDT in cents. Nothing here is a float a caller has to round again.
 */
export interface SaleQuote {
  /**
   * The whole-hryvnia total, in kopecks. **This is the number the user types
   * into their bank as the jar's goal**, and the figure every goal check
   * compares against.
   */
  readonly targetKopecks: number;
  /** USDT cents frozen for this order — the target at the sell rate. */
  readonly requiredUsdtCents: number;
}

/**
 * Prices a sale from its target and the rate it sells at.
 *
 * **The one place this arithmetic exists.** It used to be written out twice —
 * once in `SaleFacadeService` and once in the Mini App's create form,
 * with a comment on the second saying it "mirrors the first step for step".
 * Two implementations of one calculation is exactly the drift this package
 * exists to remove, and it had already produced one live bug: the quote shown
 * and the stake taken disagreed by a cent, which put a user's whole balance
 * out of reach.
 *
 * **It takes the sell rate, not the market and a markup.** Those were two
 * arguments describing one price, and every caller had to be trusted to combine
 * them the same way — including the clients, which meant the markup had to be
 * published to them. One finished rate travels instead, and a caller that has
 * it cannot arrive at a different answer from the one that quoted it.
 *
 * The target is the fixed point: it is snapped to a whole hryvnia first, and
 * the stake comes off the snapped figure. `roundToWholeUah` rather than
 * `floorToWholeUah` here on purpose — this is *normalising* a target that
 * already exists, where nearest is right. Deriving a new one from a stake is
 * {@link targetForStake}, which rounds down.
 *
 * A rate of zero or less yields a zero stake rather than an Infinity: callers
 * render this before the market has answered, and a screen full of `Infinity`
 * helps nobody.
 */
export const priceSale = (
  targetKopecks: number,
  sellRateKopecksPerUsdt: number,
): SaleQuote => {
  const target = roundToWholeUah(targetKopecks);

  return {
    targetKopecks: target,
    requiredUsdtCents:
      sellRateKopecksPerUsdt > 0
        ? Math.round((target / sellRateKopecksPerUsdt) * CENTS_PER_USDT)
        : 0,
  };
};

/**
 * The target a given stake buys — the other direction, for the create form.
 *
 * Rounded **down**, which is what keeps the stake at or below the USDT the user
 * actually typed. Rounding to nearest let the derived stake land a cent above
 * it, and a user holding exactly their balance was told they had insufficient
 * funds — see {@link floorToWholeUah}.
 *
 * Feed the result to {@link priceSale} for the rest; the two are inverse
 * by construction, so what the form shows is what the server takes.
 */
export const targetForStake = (
  usdtAmount: number,
  sellRateKopecksPerUsdt: number,
): number => floorToWholeUah(usdtAmount * sellRateKopecksPerUsdt);

/**
 * Whether a target quoted at one rate still stands at another.
 *
 * The rate moves while a user is filling the form, and the figure they were
 * told to set as their jar's goal moves with it. What matters is not that the
 * rate changed — it always does — but whether it changed enough to move the
 * target off the goal they have already set in their bank.
 *
 * So the comparison is between targets, not between rates, and it allows the
 * same one hryvnia every other goal check allows. A rate that drifts a fraction
 * of a percent leaves the target where it was and nobody is troubled; one that
 * moves it further is a real problem, because the jar will never fill to a
 * target that no longer matches.
 *
 * Both rates are **sell** rates. Passing a market rate to either side would
 * compare a target against one it was never quoted at, and the check would fail
 * on a market that had not moved at all.
 */
export const isQuoteStillValid = (
  quotedTargetKopecks: number,
  quotedSellRateKopecksPerUsdt: number,
  currentSellRateKopecksPerUsdt: number,
): boolean => {
  if (quotedSellRateKopecksPerUsdt <= 0 || currentSellRateKopecksPerUsdt <= 0) return false;

  // The stake the user is committing, recovered from what they were quoted.
  const { requiredUsdtCents } = priceSale(
    quotedTargetKopecks,
    quotedSellRateKopecksPerUsdt,
  );
  const stake = requiredUsdtCents / CENTS_PER_USDT;

  // Both sides go through `targetForStake`, deliberately — including the one at
  // the rate the user was already quoted at.
  //
  // Comparing against the submitted target instead looks more direct and is
  // wrong: `targetForStake` floors, so recovering a target from its own stake
  // lands a little low even when nothing has moved. That spent the whole
  // tolerance before the market did anything, and a one-kopeck drift then read
  // as a stale quote. Measuring both ends the same way cancels it, and leaves
  // the tolerance to mean what it says: how far the *rate* moved the target.
  const targetThen = targetForStake(stake, quotedSellRateKopecksPerUsdt);
  const targetNow = targetForStake(stake, currentSellRateKopecksPerUsdt);

  return isGoalWithinTolerance(targetNow, targetThen);
};

/**
 * Which way a converted amount is taken to the nearest whole cent.
 *
 * The choice is not cosmetic and it is not "nearest is fine". A cent of USDT is
 * worth around half a hryvnia, and the conversion is applied to figures the user
 * is either given or charged — so the direction decides who absorbs the
 * fraction, every single time.
 *
 * Pick by what the figure *is*, never by what reads tidier.
 */
export enum CentRounding {
  /**
   * To the nearest cent. For a figure that is neither a credit nor a debit on
   * its own — one half of a split whose other half is derived by subtraction,
   * so the two always add back up to what was actually held.
   */
  NEAREST = 'NEAREST',
  /**
   * Up. For money **returned** to a user, so the fraction of a cent is never
   * theirs to lose.
   *
   * This is what keeps the profit guarantee exact rather than approximate. A
   * sale that closes by refunding its unfillable tail hands back
   * `remainder / rate`, and rounding that to nearest quietly shaved up to half a
   * cent — about ₴0.23 at ₴46.52 — off what the user was owed. Negligible on a
   * ₴4 000 order and not negligible on a ₴1 tail, where it was enough to put the
   * realised return *below* the quoted rate. Rounding up costs us at most one
   * cent and makes "you keep your percent" true by construction.
   */
  UP = 'UP',
  /**
   * Down. For money **credited** against a payment somebody else made, where a
   * rounded-up fraction of a cent is USDT nobody paid for.
   *
   * The mirror of {@link UP}, and the direction a fiat top-up converts in: the
   * user transfers a fixed number of hryvnia and is credited what it buys, so
   * the remainder — at most one cent — stays with us rather than being minted.
   * Rounding it the other way would create value on every top-up, forever.
   */
  DOWN = 'DOWN',
}

/**
 * Hryvnia back into the USDT that bought it, at a given rate.
 *
 * The inverse of what {@link priceSale} does, and the one statement of
 * it. Both paths that unwind a stake need this — a cancellation working out
 * what the jar has already eaten, and a completion working out the tail it is
 * giving back — and each had written it out inline. Two copies of a conversion
 * that decides how much money goes back to a user is exactly the drift this
 * package exists to remove.
 *
 * **The rate is always the order's own snapshot, never today's.** The stake was
 * frozen at that rate, so unwinding any part of it at another would return the
 * wrong amount — in one direction or the other depending on which way the
 * market happened to move since.
 *
 * `rounding` defaults to {@link CentRounding.NEAREST}, which is right for a
 * half-of-a-split figure and wrong for a refund; see {@link CentRounding}.
 *
 * A non-positive rate or amount yields zero rather than an Infinity or a
 * negative: callers convert figures that can legitimately be zero, and a
 * refund is never a debit.
 */
export const usdtCentsForKopecks = (
  kopecks: number,
  rateKopecksPerUsdt: number,
  rounding: CentRounding = CentRounding.NEAREST,
): number => {
  if (rateKopecksPerUsdt <= 0 || kopecks <= 0) return 0;

  const exact = (kopecks / rateKopecksPerUsdt) * CENTS_PER_USDT;

  if (rounding === CentRounding.UP) return Math.ceil(exact);
  if (rounding === CentRounding.DOWN) return Math.floor(exact);

  return Math.round(exact);
};

/** Kopecks → whole hryvnia, the unit every goal check speaks. */
export const toWholeUah = (kopecks: number): number => Math.round(kopecks / KOPECKS_PER_UAH);
