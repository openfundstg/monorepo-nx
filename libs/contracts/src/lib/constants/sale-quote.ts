import {
  floorToWholeUah,
  goalToleranceKopecks,
  KOPECKS_PER_UAH,
  MIN_USDT_CENTS,
  roundToWholeUah,
} from './money.js';

/** USDT cents in one USDT. Balances are held in cents; users type whole USDT. */
export const CENTS_PER_USDT = 100;

/**
 * Everything a sale's money is made of: the total and the stake.
 *
 * One is always derived from the other — {@link priceStake} when the user typed
 * the USDT, {@link priceSale} when a total is given, such as a jar's goal. All
 * figures are integers in their own smallest unit: hryvnia in kopecks, USDT in
 * cents. Nothing here is a float a caller has to round again.
 */
export interface SaleQuote {
  /**
   * The whole-hryvnia total, in kopecks. **This is the number the user types
   * into their bank as the jar's goal**, and the figure every goal check
   * compares against.
   */
  readonly targetKopecks: number;
  /** USDT cents frozen for this order — the stake typed, or the total's price at the sell rate. */
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
 * the stake comes off the snapped figure. `roundToWholeUah` here on purpose —
 * this is *normalising* a target that already exists, where nearest is right.
 * That is the direction a jar's goal takes. A stake the user typed takes the
 * other, {@link priceStake}, where the stake is the fixed point instead.
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
 * Prices a sale from the USDT the user typed — the other direction from
 * {@link priceSale}, and the one every typed amount takes.
 *
 * **The stake is the figure typed, to the cent, and the total gives way.** A
 * total has to be a whole hryvnia — it is the goal a jar owner types into their
 * bank — and at most rates no whole hryvnia is worth exactly the stake: at
 * ₴48.15, ₴481 is 9.99 USDT and ₴482 is 10.01. Deriving the stake from the
 * total, as this product did until 2026-09-24, therefore sold a different
 * amount from the one typed more often than not — seven times in ten across
 * whole amounts at that month's rates, always a cent or two short — and a
 * seller who typed ten and found 9.98 on the finished sale read it as money
 * going missing.
 *
 * So the rounding moves to the side that has to be whole. The total is the
 * stake's exact price rounded to the **nearest** hryvnia, which puts it at most
 * half a hryvnia either side of that price; an exact half goes up, so across
 * sales it leans a few kopecks the seller's way and never against them. Not
 * down: a floored total prices every sale up to a hryvnia under the quoted
 * rate, and always against the seller.
 *
 * The stake in cents times the rate in kopecks is an exact integer, so the one
 * division before the rounding can only land on a half where the price really
 * is one — no float puts a total on the wrong side of it.
 *
 * A rate of zero or less yields a zero total: callers render this before the
 * market has answered, and a total invented without a rate is not a price.
 */
export const priceStake = (
  stakeCents: number,
  sellRateKopecksPerUsdt: number,
): SaleQuote => ({
  targetKopecks:
    sellRateKopecksPerUsdt > 0
      ? roundToWholeUah((stakeCents * sellRateKopecksPerUsdt) / CENTS_PER_USDT)
      : 0,
  requiredUsdtCents: stakeCents,
});

/**
 * How far a whole-hryvnia total can sit below the exact price of the stake it
 * stands for, in kopecks — whichever way it was rounded on its way here.
 *
 * One hryvnia. {@link priceStake} rounds to the nearest and never goes more
 * than half of one below; a floored total can go a whole one below, and that
 * is how every client priced a typed sale before 2026-09-24 and how a jar owner
 * who types their goal down sets it. The minimum has to admit all of them.
 */
export const TARGET_ROUNDING_SLACK_KOPECKS = KOPECKS_PER_UAH;

/**
 * The smallest target a sale may carry, in kopecks, at this rate.
 *
 * **Measured as a total, not as a stake.** A typed sale's stake is exact —
 * {@link priceStake} — and could be held against ten USDT directly. A sale held
 * at a jar's goal cannot: its stake is recovered from the goal, lands a cent
 * either side of any round figure, and drifts further as the rate moves while
 * the form is open. Comparing a recovered stake against a flat `MIN_USDT_CENTS`
 * is what once refused the minimum itself — ten typed, 9.99 recovered, refused
 * beside a line reading "minimum 10 USDT" — because it put the floor in
 * different units from every rounding step that had already touched the
 * figure. One threshold, in the units the drift happens in, serves both kinds
 * of sale.
 *
 * **This is not the old "check the stake, never the total" mistake.** That rule
 * is about comparing a target against a *fixed hryvnia figure*, which would let
 * a sale staking under the minimum qualify by totalling more once the markup is
 * counted. The threshold here is derived from the rate, so both sides carry the
 * same markup and the objection does not apply — `target >= minSaleTargetKopecks(rate)`
 * says "this sale is at least the minimum amount at today's rate" and nothing else.
 *
 * **Two allowances, and each is somebody else's number rather than one picked
 * here:**
 *
 * - {@link TARGET_ROUNDING_SLACK_KOPECKS}, for a total rounded to a whole
 *   hryvnia on its way here, whoever rounded it.
 * - {@link goalToleranceKopecks}, for a sale held at its jar's goal while the
 *   rate moves. The jar form keeps the goal and re-derives the stake when the
 *   market ticks, because the goal lives in a banking app and the stake is a
 *   number on the screen — so a rise leaves the same target worth slightly
 *   less USDT, and a floor that did not allow it would refuse a sale for
 *   becoming cheaper. The allowance is the goal check's own: a jar within it
 *   of the minimum target is, to every other rule, a jar set to the minimum.
 *
 * Together they put the effective floor around 9.85 USDT at the worst rate,
 * which is the price of the roundings and is immaterial to what the minimum is
 * for: below it the fixed cost of a transfer outweighs the amount moved.
 *
 * A rate of zero yields a floor of zero, which is the same "nothing is priced
 * yet" answer {@link priceSale} gives: a screen renders this before the market
 * has answered, and a floor invented without a rate is not a floor.
 */
export const minSaleTargetKopecks = (sellRateKopecksPerUsdt: number): number => {
  const nominal = priceStake(MIN_USDT_CENTS, sellRateKopecksPerUsdt).targetKopecks;

  return Math.max(0, nominal - TARGET_ROUNDING_SLACK_KOPECKS - goalToleranceKopecks(nominal));
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

/**
 * How short a recipient name a card sale will accept.
 *
 * Here rather than on either side, because both enforce it: the form disables
 * its button and `CardSaleDestinationService` refuses the request. That is
 * exactly the arrangement the root `CLAUDE.md` names — a rule the screen shows
 * and the backend enforces for real may not be stated twice — and it was,
 * briefly, in two files whose comments each pointed at the other.
 *
 * Three, which is a surname and an initial rather than a length anybody has
 * measured. What it excludes is an empty box and a stray character, not a short
 * name: it is a guard against nothing being typed, and the statement is what
 * actually establishes who the account belongs to.
 */
export const MIN_RECEIVER_NAME_LENGTH = 3;

/**
 * How many Transacto orders a card sale may ever be split into.
 *
 * A card sale has no scraper behind it: the only record that hryvnia arrived is
 * the seller pressing a button. `SaleBlockReason.LEDGER_MISMATCH` — the guard
 * that catches money counted twice — compares two independent records and so
 * cannot exist here at all.
 *
 * This number is what stands in its place. Together with
 * {@link saleCardMinOrderKopecks} and a credential capped at one open order, it
 * bounds what a single unnoticed mistake can cost at roughly a seventh of the
 * sale rather than the whole of it. It is not a tuning knob, and raising it
 * widens that blast radius in exact proportion.
 */
export const SALE_CARD_MAX_ORDERS = 7;

/**
 * The smallest order a card sale will accept, in kopecks.
 *
 * An equal share of the target, floored to a whole hryvnia, but never below the
 * pipeline's own floor. Transacto enforces it as `min_amount` on the credential,
 * so this is not advice to a payer — it is the number that stops an eighth order
 * from ever being routed.
 *
 * **It floors, and the direction is load-bearing.** Let `t` be the target in
 * hryvnia and `m = floor(t / 7)`. Then `t = 7m + r` with `0 ≤ r < 7`, so
 * `floor(t / m) = 7 + floor(r / m)`, and `floor(r / m)` is zero for every `m`
 * above six — which the ₴300 pipeline floor guarantees by two orders of
 * magnitude. Exactly seven orders fit, with at most ₴6 left over.
 *
 * Rounding **up** looks equally defensible and quietly costs a whole order:
 * `ceil(10 000 / 7) = 1 429`, seven of which is ₴10 003 — so only six fit, and
 * ₴1 426 of the sale becomes an unfillable tail the user gets back as USDT
 * instead of the hryvnia they asked for.
 *
 * The floor argument is taken the other way, **up** to a whole hryvnia, because
 * it is somebody else's minimum: rounding a ₴300.50 floor down to ₴300 would
 * publish a minimum Transacto refuses to route.
 */
export const saleCardMinOrderKopecks = (
  targetKopecks: number,
  floorKopecks: number,
): number =>
  // `|| pipelineFloorKopecks` because the two answer different questions. This
  // one is printed on the create form and sent as the credential's `min_amount`
  // — "the smallest order a sale this size will take" — and has an answer even
  // for a target too small to route at all, which is the pipeline's own floor.
  // The general form returns `0` there instead, because its caller has to *act*
  // on nothing being routable.
  saleCardOrderFloorKopecks(targetKopecks, floorKopecks, SALE_CARD_MAX_ORDERS) ||
  pipelineFloorKopecks(floorKopecks);

/**
 * The pipeline's own floor, taken up to a whole hryvnia.
 *
 * **Up, not down, because it is somebody else's minimum:** rounding a ₴300.50
 * floor down to ₴300 would publish a figure Transacto refuses to route.
 */
export const pipelineFloorKopecks = (floorKopecks: number): number =>
  Math.ceil(floorKopecks / KOPECKS_PER_UAH) * KOPECKS_PER_UAH;

/**
 * The same figure, for a sale that is already part-filled.
 *
 * **A card sale's minimum is not fixed for its lifetime, and treating it as one
 * strands money.** Suppose a ₴10 000 sale, minimum ₴1 428, seven orders. Two
 * payers send ₴4 500 each: ₴9 000 has arrived, ₴1 000 is left, and five of the
 * seven slots are unused — but nothing under ₴1 428 can be routed, so the ₴1 000
 * is unreachable and the sale simply stops. The user asked for ₴10 000, received
 * ₴9 000, and the rest comes back as USDT they did not want.
 *
 * So the share is taken again after every order that settles, over what is
 * actually left and the slots that are actually free: ₴1 000 across five slots
 * is ₴200, which the ₴300 pipeline floor then lifts to ₴300 — three more orders
 * instead of none.
 *
 * **It is not a ratchet, and an earlier draft of this comment claimed it was.**
 * The minimum can rise a little: flooring to whole hryvnia leaves up to ₴1 of
 * each order's true share in the remainder, and that residue divided by fewer
 * slots can come out above the opening figure. A ₴10 000 sale opens at ₴1 428
 * and reaches ₴1 429 by its fourth order. What is actually guaranteed is
 * weaker and is the property that matters: the minimum is never more than what
 * is left, so the split always stays feasible.
 *
 * Returns `0` when nothing more can be routed at all: no slots left, or a
 * remainder smaller than the pipeline will carry. That is a real state and the
 * caller has to act on it — the tail becomes a refund or an operator's transfer
 * — rather than a minimum of zero, which would mean "any amount".
 */
export const saleCardOrderFloorKopecks = (
  remainingKopecks: number,
  floorKopecks: number,
  ordersLeft: number,
): number => {
  const pipelineFloor = pipelineFloorKopecks(floorKopecks);

  if (ordersLeft <= 0 || remainingKopecks < pipelineFloor) return 0;

  const equalShare = floorToWholeUah(remainingKopecks / ordersLeft);

  return Math.max(pipelineFloor, equalShare);
};

/**
 * How many orders a given target will actually be split into, at most.
 *
 * {@link SALE_CARD_MAX_ORDERS} whenever the equal share clears the pipeline
 * floor, and fewer below that: a ₴1 000 sale cannot be seven ₴142 orders because
 * nothing under ₴300 is routable, so it is at most three.
 *
 * The Mini App names this figure on the create form. A user who is told "up to 7
 * transfers" and receives three has been told something false about how their
 * money arrives, and the same arithmetic has to produce both that sentence and
 * the credential's limits or they will disagree.
 */
export const saleCardMaxOrders = (targetKopecks: number, floorKopecks: number): number => {
  const min = saleCardMinOrderKopecks(targetKopecks, floorKopecks);
  if (min <= 0 || targetKopecks < min) return 0;

  return Math.min(SALE_CARD_MAX_ORDERS, Math.floor(targetKopecks / min));
};
