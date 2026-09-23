import {
  CentRounding,
  DEFAULT_MIN_ORDER_KOPECKS,
  goalToleranceKopecks,
  isQuoteStillValid,
  TARGET_FLOOR_SLACK_KOPECKS,
  MIN_USDT_AMOUNT,
  MIN_USDT_CENTS,
  minSaleTargetKopecks,
  priceSale,
  SALE_CARD_MAX_ORDERS,
  saleCardMaxOrders,
  saleCardMinOrderKopecks,
  targetForStake,
  usdtCentsForKopecks,
  saleCardOrderFloorKopecks
} from '@transacto/contracts'

/**
 * The **sell** rate, in kopecks per USDT — the only rate this file deals in.
 *
 * These helpers used to take a market rate and a markup and combine them
 * themselves, which meant every caller had to be trusted to combine them the
 * same way. They take the finished rate now; `sellRate` is what produces it,
 * and `rate-spread.spec.ts` is where that is tested.
 */
const RATE = 4709

describe('priceSale', () => {
  /**
   * The invariant the whole calculation rests on: the stake is the target at
   * the sell rate, and nothing else. It used to be the target with a profit
   * split off it and the remainder priced at the market — the same number by a
   * longer road, and one that needed two rates to walk.
   */
  it('stakes the target at the rate it was given', () => {
    for (let target = 10_000; target <= 1_000_000; target += 7_300) {
      const { targetKopecks, requiredUsdtCents } = priceSale(target, RATE)

      expect(requiredUsdtCents).toBe(Math.round((targetKopecks / RATE) * 100))
    }
  })

  it('snaps the target to a whole hryvnia', () => {
    expect(priceSale(234_949, RATE).targetKopecks).toBe(234_900)
    expect(priceSale(234_951, RATE).targetKopecks).toBe(235_000)
  })

  /** Screens render this before the market has answered. */
  it.each([0, -1])('yields a zero stake at a rate of %p rather than Infinity', (rate) => {
    expect(priceSale(100_000, rate).requiredUsdtCents).toBe(0)
  })
})

describe('targetForStake', () => {
  /**
   * The two are inverse by construction — that is the whole point of them
   * living together. A stake put through both must never come back larger than
   * it went in, or a user holding exactly their balance is told they cannot
   * afford to spend it.
   */
  it('never quotes a stake above the amount typed', () => {
    for (let cents = 1_000; cents <= 50_000; cents += 7) {
      const usdt = cents / 100
      const target = targetForStake(usdt, RATE)

      expect(priceSale(target, RATE).requiredUsdtCents).toBeLessThanOrEqual(cents)
    }
  })

  it('rounds the target down to a whole hryvnia', () => {
    const target = targetForStake(10.02, 4000, 1)

    expect(target % 100).toBe(0)
  })
})

/**
 * **The bug: a user could not sell the minimum amount.**
 *
 * They type ten USDT. `targetForStake` floors the total to a whole hryvnia so
 * the stake never lands above what they typed, and `priceSale` then recovers
 * the stake from that floored total — a round trip that is lossy by
 * construction. Ten came back as 9.99 and was refused, by the form and by the
 * server, beside a line reading "minimum 10 USDT".
 *
 * Not an edge case: it happened on every rate where `10 × rate` does not land
 * on a whole hryvnia, which is every rate that is not a multiple of ten
 * kopecks — 210 of the 300 whole-kopeck rates between ₴46 and ₴49 alone.
 *
 * The rates below are swept rather than sampled, because the failure was a
 * property of the arithmetic at particular rates and any single fixture would
 * have passed.
 */
describe('minSaleTargetKopecks', () => {
  /** Every whole-kopeck rate from ₴30 to ₴60, which is the plausible band. */
  const RATES = Array.from({ length: 3_001 }, (_, index) => 3_000 + index)

  /**
   * The whole point, with the trap it walks past stated in the same test.
   *
   * The first assertion is the bug: on most rates the stake this target
   * recovers is a cent or two under ten USDT, which is exactly what the old
   * cents-based floor compared and refused. The second is the fix — measured as
   * a target, the same sale is admitted at every rate.
   */
  it('admits the minimum amount at every rate, where measuring in cents did not', () => {
    const quotes = RATES.map((rate) => ({
      rate,
      target: targetForStake(MIN_USDT_AMOUNT, rate),
      stake: priceSale(targetForStake(MIN_USDT_AMOUNT, rate), rate).requiredUsdtCents
    }))

    const shortInCents = quotes.filter(({ stake }) => stake < MIN_USDT_CENTS)

    // Most of them, not a handful: this is what "not an edge case" means.
    expect(shortInCents.length).toBeGreaterThan(quotes.length / 2)

    expect(quotes.filter(({ rate, target }) => target < minSaleTargetKopecks(rate))).toEqual([])
  })

  /** …and the rate the bug was found on, named so a regression says which. */
  it('admits ten USDT at a rate that does not divide into whole hryvnia', () => {
    const target = targetForStake(MIN_USDT_AMOUNT, 4_804)

    // ₴480 rather than ₴480.40 — the floor, and the whole of the problem.
    expect(target).toBe(48_000)
    expect(priceSale(target, 4_804).requiredUsdtCents).toBe(999)
    expect(target).toBeGreaterThanOrEqual(minSaleTargetKopecks(4_804))
  })

  /**
   * The allowance is for our own rounding, not a discount. Anything a user
   * could actually ask for below the minimum is still refused.
   */
  it('refuses an amount under the minimum at every rate', () => {
    const admitted = RATES.filter(
      (rate) => targetForStake(MIN_USDT_AMOUNT - 1, rate) >= minSaleTargetKopecks(rate)
    )

    expect(admitted).toEqual([])
  })

  /**
   * **The second hryvnia of the allowance, earning its place.**
   *
   * The server prices the *submitted* target at the *current* rate, so a rate
   * that ticks up while the form is open leaves the same target worth slightly
   * less USDT — and a floor pinned to ten flat refused a sale for becoming
   * cheaper. Anything `isQuoteStillValid` lets through must reach the floor
   * intact; a larger move is refused there, with a message that names the rate.
   */
  it('admits every quoted minimum that the quote check still accepts', () => {
    const refused = RATES.flatMap((quoted) => {
      const target = targetForStake(MIN_USDT_AMOUNT, quoted)

      return RATES.filter(
        (now) =>
          Math.abs(now - quoted) <= 400 &&
          isQuoteStillValid(target, quoted, now) &&
          target < minSaleTargetKopecks(now)
      ).map((now) => ({ quoted, now }))
    })

    expect(refused).toEqual([])
  })

  /** It lowers the floor by exactly its slack and not a kopeck more. */
  it('allows the floor its hryvnia and the quote check its drift, and no more', () => {
    for (const rate of [3_000, 4_000, 4_804, 5_500, 6_000]) {
      const nominal = targetForStake(MIN_USDT_AMOUNT, rate)

      expect(minSaleTargetKopecks(rate)).toBe(
        nominal - TARGET_FLOOR_SLACK_KOPECKS - goalToleranceKopecks(nominal)
      )
    }
  })

  /**
   * Screens render this before the market has answered. A floor invented
   * without a rate is not a floor — and the target is zero there too, so
   * nothing is refused for being under it.
   */
  it.each([0, -1])('yields no floor at a rate of %p', (rate) => {
    expect(minSaleTargetKopecks(rate)).toBe(0)
  })
})

describe('isQuoteStillValid', () => {
  const TARGET = targetForStake(50, RATE)

  it('holds when the rate has not moved', () => {
    expect(isQuoteStillValid(TARGET, RATE, RATE)).toBe(true)
  })

  /**
   * Compared on targets, not on rates. The rate always changes — it is re-read
   * every five minutes — and refusing on that alone would reject most
   * submissions for nothing a user could act on.
   */
  it('holds through a drift too small to move the target', () => {
    expect(isQuoteStillValid(TARGET, RATE, RATE + 1)).toBe(true)
    expect(isQuoteStillValid(TARGET, RATE, RATE - 1)).toBe(true)
  })

  /** Past a hryvnia the jar's goal no longer matches, and it can never fill. */
  it.each([
    ['a rise', RATE + 200],
    ['a fall', RATE - 200],
  ])('fails on %s that moves the target', (_label, now) => {
    expect(isQuoteStillValid(TARGET, RATE, now)).toBe(false)
  })

  it.each([0, -1])('fails rather than dividing by a rate of %p', (rate) => {
    expect(isQuoteStillValid(TARGET, rate, RATE)).toBe(false)
    expect(isQuoteStillValid(TARGET, RATE, rate)).toBe(false)
  })
})

describe('usdtCentsForKopecks', () => {
  /** ₴10 per USDT, so the arithmetic reads off the page. */
  const RATE = 1_000

  it('converts at the given rate', () => {
    expect(usdtCentsForKopecks(10_000, RATE)).toBe(1_000)
  })

  it('rounds to the nearest cent', () => {
    expect(usdtCentsForKopecks(10_005, RATE)).toBe(1_001)
    expect(usdtCentsForKopecks(10_004, RATE)).toBe(1_000)
  })

  /**
   * Callers convert figures that can legitimately be zero — a tail on a fully
   * filled jar, a cancellation before any money arrived — and a refund is never
   * a debit.
   */
  it.each([
    ['a zero amount', 0, RATE],
    ['a negative amount', -5_000, RATE],
    ['a zero rate', 10_000, 0],
    ['a negative rate', 10_000, -1],
  ])('is zero for %s', (_label, kopecks, rate) => {
    expect(usdtCentsForKopecks(kopecks, rate)).toBe(0)
  })

  describe('rounding direction', () => {
    /** ₴1 at ₴46.52 per USDT is 2.149 cents — the case that exposed the leak. */
    const FRACTIONAL = 100
    const LIVE_RATE = 4_652

    it('takes the nearest cent by default', () => {
      expect(usdtCentsForKopecks(FRACTIONAL, LIVE_RATE)).toBe(2)
    })

    /**
     * Money **returned** to a user rounds up, so the fraction of a cent is never
     * theirs to lose. On a sale's refunded tail that fraction was worth
     * more than the profit inside the tail, and the realised return came out
     * below the rate the order was quoted at.
     */
    it('rounds up for a figure being handed back', () => {
      expect(usdtCentsForKopecks(FRACTIONAL, LIVE_RATE, CentRounding.UP)).toBe(3)
    })

    it('agrees with itself on an exact conversion', () => {
      expect(usdtCentsForKopecks(10_000, 1_000, CentRounding.UP)).toBe(1_000)
      expect(usdtCentsForKopecks(10_000, 1_000, CentRounding.NEAREST)).toBe(1_000)
    })

    /** Rounding up must not conjure a cent out of nothing. */
    it('stays at zero for nothing to convert', () => {
      expect(usdtCentsForKopecks(0, LIVE_RATE, CentRounding.UP)).toBe(0)
      expect(usdtCentsForKopecks(-1, LIVE_RATE, CentRounding.UP)).toBe(0)
    })
  })

  /**
   * The inverse of {@link priceSale}'s stake, within a cent — and the
   * property the whole settlement rests on now that one rate does both jobs:
   * an order delivered in full converts back to exactly what it froze.
   *
   * It did not hold before. The stake was taken at the sell rate and the
   * settlement converted back at the market, so a fully delivered order
   * consumed more USDT than it had frozen and was saved only by a clamp.
   */
  it('round-trips a priced order back to its stake', () => {
    const { targetKopecks, requiredUsdtCents } = priceSale(404_000, 4_745)

    expect(usdtCentsForKopecks(targetKopecks, 4_745)).toBe(requiredUsdtCents)
  })
})

/**
 * The card variant's only guard.
 *
 * A card sale has no scraper and therefore no second record of the money, so
 * `SaleBlockReason.LEDGER_MISMATCH` cannot be built for it. These three numbers
 * are what stands in its place, and every assertion below is really about the
 * same thing: how much one unnoticed mistake can cost.
 */
describe('card sale order limits', () => {
  /** The pipeline floor, and what the backend passes in from configuration. */
  const FLOOR = DEFAULT_MIN_ORDER_KOPECKS

  describe('saleCardMinOrderKopecks', () => {
    /** The example the rule was specified with: ₴10 000 ÷ 7 = ₴1 428,57. */
    it('takes an equal share of the target, floored to a whole hryvnia', () => {
      expect(saleCardMinOrderKopecks(10_000_00, FLOOR)).toBe(1_428_00)
    })

    /**
     * The whole reason the share is floored rather than rounded up.
     *
     * `ceil(10 000 / 7)` is ₴1 429, and seven of those is ₴10 003 — above the
     * target, so only six orders could ever be routed and ₴1 426 of the sale
     * would come back as USDT instead of the hryvnia the user asked for.
     */
    it('leaves room for every one of the seven orders', () => {
      for (let target = 2_100_00; target <= 500_000_00; target += 1_237_00) {
        expect(saleCardMinOrderKopecks(target, FLOOR) * SALE_CARD_MAX_ORDERS).toBeLessThanOrEqual(
          target
        )
      }
    })

    /** Below ₴2 100 an equal share is under the floor, and the floor wins. */
    it('never goes under the pipeline floor', () => {
      expect(saleCardMinOrderKopecks(1_000_00, FLOOR)).toBe(FLOOR)
      expect(saleCardMinOrderKopecks(10_00, FLOOR)).toBe(FLOOR)
    })

    /**
     * The floor is somebody else's minimum, so it is taken **up** to a whole
     * hryvnia. Flooring it would publish a minimum Transacto refuses to route.
     */
    it('rounds a fractional floor up rather than down', () => {
      expect(saleCardMinOrderKopecks(1_000_00, 300_50)).toBe(301_00)
    })
  })

  describe('saleCardMaxOrders', () => {
    /**
     * Seven, exactly, for every target the equal share governs — the property
     * the floored share was chosen to give: with `t = 7m + r` and `r < 7`,
     * `floor(t / m)` is 7 for every `m` above six.
     */
    it('splits into exactly seven wherever the share clears the floor', () => {
      for (let target = 2_100_00; target <= 500_000_00; target += 1_237_00) {
        expect(saleCardMaxOrders(target, FLOOR)).toBe(SALE_CARD_MAX_ORDERS)
      }
    })

    /** …and fewer below that, because nothing under ₴300 is routable. */
    it('splits into fewer when the floor governs', () => {
      expect(saleCardMaxOrders(1_000_00, FLOOR)).toBe(3)
      expect(saleCardMaxOrders(600_00, FLOOR)).toBe(2)
    })

    /** A target no single order could fill is not one order — it is none. */
    it('is zero for a target under the floor', () => {
      expect(saleCardMaxOrders(299_00, FLOOR)).toBe(0)
    })
  })
})

describe('saleCardOrderFloorKopecks', () => {
  /** ₴300, the smallest order the pipeline will route. */
  const FLOOR = 30_000

  /**
   * The case a fixed minimum strands.
   *
   * A ₴10 000 sale opens at ₴1 428 across seven slots. Two payers send ₴4 500
   * each: ₴1 000 is left and five slots are free, but nothing under ₴1 428 can
   * be routed — so the sale stops with ₴1 000 it was perfectly able to collect,
   * and the user gets USDT back instead of the hryvnia they asked for.
   */
  it('reopens a sale a fixed minimum would have stranded', () => {
    expect(saleCardMinOrderKopecks(1_000_000, FLOOR)).toBe(142_800)

    // ₴1 000 left across five free slots is ₴200, which the ₴300 floor lifts.
    expect(saleCardOrderFloorKopecks(100_000, FLOOR, 5)).toBe(FLOOR)
  })

  it('divides what is left by the slots that are free', () => {
    expect(saleCardOrderFloorKopecks(500_000, FLOOR, 4)).toBe(125_000)
  })

  /**
   * **The split always stays feasible**, which is the property that matters —
   * and is weaker than the one an earlier version of this claimed.
   *
   * The minimum is not monotonic. Flooring to whole hryvnia leaves up to ₴1 of
   * each order's true share behind, and that residue divided by fewer slots can
   * come out above the opening figure: a ₴10 000 sale opens at ₴1 428 and
   * reaches ₴1 429 by its fourth order. What must never happen is a minimum
   * larger than what is left, because that is the state where the remainder is
   * unreachable — the exact failure this recomputation exists to prevent.
   */
  it('never asks for more than is left, at any point in a sale', () => {
    const opening = saleCardMinOrderKopecks(1_000_000, FLOOR)

    for (let settled = 1; settled < 7; settled += 1) {
      const remaining = 1_000_000 - settled * opening
      const min = saleCardOrderFloorKopecks(remaining, FLOOR, 7 - settled)

      expect(min).toBeLessThanOrEqual(remaining)
    }
  })

  /**
   * `0` is a real state and not a minimum of zero, which would mean "any amount
   * at all". The caller has to act on it — the tail becomes a refund or an
   * operator's transfer.
   */
  it.each([
    ['no slots left', 100_000, 0],
    ['a remainder under the pipeline floor', 29_999, 5],
    ['nothing left at all', 0, 5]
  ])('routes nothing when there is %s', (_case, remaining, ordersLeft) => {
    expect(saleCardOrderFloorKopecks(remaining, FLOOR, ordersLeft)).toBe(0)
  })

  /** The opening figure is this function with every slot free — one statement of it. */
  it('is what the opening minimum is made of', () => {
    for (const target of [500_000, 1_000_000, 4_000_000]) {
      expect(saleCardMinOrderKopecks(target, FLOOR)).toBe(
        saleCardOrderFloorKopecks(target, FLOOR, SALE_CARD_MAX_ORDERS)
      )
    }
  })
})
