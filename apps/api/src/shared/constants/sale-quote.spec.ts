import {
  CentRounding,
  isQuoteStillValid,
  priceSale,
  targetForStake,
  usdtCentsForKopecks,
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
