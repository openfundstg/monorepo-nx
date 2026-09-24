/**
 * Smallest amount of USDT the product will handle, in whole USDT.
 *
 * The same floor for a deposit and for a sale: below it the fixed costs
 * of a transfer and a terminal outweigh the amount being moved. It lives here
 * because both apps need it — the Mini App to disable the button and say why,
 * the backend to enforce it — and a client-side-only minimum is no minimum at
 * all, since the request can be made without the client.
 */
export const MIN_USDT_AMOUNT = 10;

/** The same floor in USDT cents, which is how balances are held. */
export const MIN_USDT_CENTS = MIN_USDT_AMOUNT * 100;

/** Kopecks in one hryvnia. Fiat crosses the wire in kopecks, always. */
export const KOPECKS_PER_UAH = 100;

/**
 * The smallest order Transacto will route to a terminal, in UAH kopecks.
 *
 * A fact about the payment pipeline rather than a policy of ours, and the same
 * figure for every bank. It lives here because three separate rules hang off it
 * and they must not drift apart:
 *
 * - the jar-full alert, the trader's cue that the rest has to be paid in by hand;
 * - the funding rule, which lets an order close on a top-up no order accounts for;
 * - and the Mini App's remainder choice, which has to *name* the figure to the
 *   user — "anything under ₴300 comes back to your balance" is the offer, so a
 *   client working from a stale copy would be describing a different product.
 *
 * A terminal is created with `max_turnover` equal to its target, so once a jar
 * is within this of its goal there is no room left for an order big enough to
 * exist. That is what makes the tail unfillable rather than merely slow.
 *
 * The backend may override it from configuration and ships the live value in
 * `SaleConfigResponse`; this is the floor everything falls back to.
 */
export const DEFAULT_MIN_ORDER_KOPECKS = 300 * KOPECKS_PER_UAH;

/**
 * Rounds a kopeck figure to a whole number of hryvnia, still in kopecks.
 *
 * **This is a wire convention, not a display choice.** A sale's target
 * is the number the user has to type into their bank as the jar's goal, and no
 * bank asks for kopecks — so a target of ₴9 490,08 is one nobody can enter, and
 * the goal check would then block every order that was set up correctly.
 *
 * It lives here rather than in either app because both compute it: the Mini App
 * to show the figure and freeze the right stake, the backend to store it and
 * compare it against what the bank reports. Two implementations that rounded
 * even slightly differently would block orders for no reason, which is exactly
 * the drift this package exists to remove.
 */
export const roundToWholeUah = (kopecks: number): number =>
  Math.round(kopecks / KOPECKS_PER_UAH) * KOPECKS_PER_UAH;

/**
 * Rounds a kopeck figure **down** to a whole number of hryvnia.
 *
 * Not interchangeable with {@link roundToWholeUah}, and the direction is the
 * point wherever this is used: a card sale's equal share of its target is
 * floored so that the last of its orders still fits under the total — see
 * `saleCardMinOrderKopecks`.
 *
 * It used to derive a typed sale's target as well, floored so that the stake
 * recovered from that target could never land above the USDT typed — rounding
 * to nearest there had quoted someone holding exactly 100 USDT a stake of
 * 100.01. The floor kept every balance spendable at the cost of selling a cent
 * or two less than typed on most sales, and it went when the stake stopped
 * being recovered at all: `priceStake` freezes the figure typed and rounds the
 * total to the nearest hryvnia instead.
 */
export const floorToWholeUah = (kopecks: number): number =>
  Math.floor(kopecks / KOPECKS_PER_UAH) * KOPECKS_PER_UAH;

/** Whether a kopeck figure is already a whole number of hryvnia. */
export const isWholeUah = (kopecks: number): boolean =>
  Number.isInteger(kopecks) && kopecks % KOPECKS_PER_UAH === 0;

/**
 * How far a jar's target may sit from the order's before the two are called
 * different, in kopecks.
 *
 * One hryvnia, either way. The figures are compared in whole hryvnia already,
 * so this is not about rounding inside a single conversion — it is about the
 * person. They are told to set a target of ₴2 349 and they set ₴2 350, because
 * that is what a human does with a number. Blocking that costs them a frozen
 * stake and a support message, and gains nothing: a hryvnia neither breaks the
 * economics nor hides an abuse the rule exists to catch.
 *
 * Rounding the order's target *down* from the exact conversion, as the create
 * form did for a while, made the near-miss more common: a user rounding their
 * own figure up was a hryvnia out far more often than when both sides rounded
 * to nearest. Both round to nearest again now, and the hryvnia stays — people
 * still type the round figure rather than the one they were given.
 */
export const GOAL_TOLERANCE_KOPECKS = 100;

/**
 * …and the same allowance as a share of the order, for the orders a hryvnia is
 * absurd on.
 *
 * A flat hryvnia is 0.015% of a ₴6 642 order. Banks round their own goal
 * fields, owners retype figures, and at least one — NovaPay — has been observed
 * reporting a goal four hryvnia above what its own page displays; none of that
 * stops a jar filling, and all of it blocked orders that were set up correctly.
 *
 * One percent is the point where a mismatch stops looking like a rounding and
 * starts looking like a different jar, which is the mistake the check is for.
 */
export const GOAL_TOLERANCE_PERCENT = 1;

/**
 * Whether a jar's target is the order's target, allowing whichever is larger of
 * {@link GOAL_TOLERANCE_KOPECKS} and {@link GOAL_TOLERANCE_PERCENT} of the
 * order.
 *
 * Both sides are snapped to whole hryvnia first, because that is the only
 * precision a bank's goal field can express and some banks report their own
 * rounding — ₴2 350 coming back as 234 999 or 235 001 kopecks is the same jar.
 * The tolerance is applied on top of that, not instead of it.
 *
 * The percentage is what makes the check mean the same thing at both ends of
 * the range. A flat hryvnia is generous on a ₴300 order and absurd on a ₴9 000
 * one, where it blocked orders over drifts of a few hryvnia that no jar cares
 * about; the flat figure stays as the floor so small orders keep the allowance
 * they had.
 *
 * Symmetric on purpose: a target set low is as ordinary a mistake as one set
 * high, and neither is worth a block.
 *
 * Lives here so the create form, the creation check and the running-order
 * compliance check cannot disagree about what counts as a match — a client that
 * allowed the gap while the server refused it would let a user submit an order
 * that was blocked the moment it started.
 */
export const isGoalWithinTolerance = (observedKopecks: number, targetKopecks: number): boolean => {
  const target = roundToWholeUah(targetKopecks);

  return Math.abs(roundToWholeUah(observedKopecks) - target) <= goalToleranceKopecks(target);
};

/**
 * How far a target of this size may drift before anything treats it as a
 * different figure, in kopecks.
 *
 * Lifted out of {@link isGoalWithinTolerance} because a second rule needs the
 * same number rather than the same verdict: a sale's minimum has to admit a jar
 * the goal check still calls the minimum target after the rate has moved under
 * it, and it can only do that by asking how much that check tolerates. Written
 * out twice, the two would be one percentage change away from disagreeing — and
 * the shape of that disagreement is a user being refused the minimum order for
 * a rate move already declared acceptable.
 *
 * The argument is snapped to whole hryvnia first, exactly as the caller above
 * does it, so both ends of the comparison are measured on the same figure.
 */
export const goalToleranceKopecks = (targetKopecks: number): number =>
  Math.max(
    GOAL_TOLERANCE_KOPECKS,
    Math.round((Math.abs(roundToWholeUah(targetKopecks)) * GOAL_TOLERANCE_PERCENT) / 100),
  );
