import {
  BUY_DISCOUNT_PERCENT,
  buyRate,
  CentRounding,
  isSpreadOrdered,
  roundTripProfitKopecks,
  roundTripProfitPercent,
  SELL_MARKUP_PERCENT,
  sellRate,
  usdtCentsForKopecks
} from '@transacto/contracts'

/** A live market figure, in the shape everything here receives it. */
const MARKET = 4650

describe('buyRate', () => {
  /**
   * The direction, which is the whole thing. Kopecks per USDT, so a discount
   * makes the number *smaller* — and 46.73 looks exactly as plausible beside a
   * market of 46.50 as 46.27 does. Nothing else in this file matters if this
   * is wrong.
   */
  it('quotes fewer kopecks per USDT than the market', () => {
    expect(buyRate(MARKET)).toBeLessThan(MARKET)
  })

  it('discounts by the advertised percent', () => {
    expect(buyRate(MARKET)).toBe(
      Math.floor(MARKET * (1 - BUY_DISCOUNT_PERCENT / 100))
    )
  })

  /**
   * The point of the discount, stated as the user experiences it: the same
   * hryvnia buy more USDT here than they do at the market rate.
   */
  it('credits more USDT for the same hryvnia than the market rate does', () => {
    for (let amount = 50_000; amount <= 4_000_000; amount += 137_000) {
      const atMarket = usdtCentsForKopecks(amount, MARKET, CentRounding.DOWN)
      const atFiat = usdtCentsForKopecks(amount, buyRate(MARKET), CentRounding.DOWN)

      expect(atFiat).toBeGreaterThan(atMarket)
    }
  })

  /**
   * Rounded down, so the fraction of a kopeck goes the same way the whole 0.5%
   * does. Rounding to nearest would advertise a discount and occasionally
   * deliver a slightly smaller one.
   */
  it('never quotes above the exact discounted rate', () => {
    for (let market = 3_000; market <= 8_000; market += 7) {
      expect(buyRate(market)).toBeLessThanOrEqual(
        market * (1 - BUY_DISCOUNT_PERCENT / 100)
      )
    }
  })

  /**
   * Callers render this before the panel has answered. Zero is what every
   * screen here already reads as "not known"; a negative rate would be priced.
   */
  it.each([0, -1])('answers zero for an unusable market rate (%p)', (market) => {
    expect(buyRate(market)).toBe(0)
  })
})

describe('sellRate', () => {
  /** The mirror of the buy rate's direction, and just as easy to get backwards. */
  it('quotes more kopecks per USDT than the market', () => {
    expect(sellRate(MARKET)).toBeGreaterThan(MARKET)
  })

  it('marks up by the advertised percent', () => {
    expect(sellRate(MARKET)).toBe(Math.ceil(MARKET * (1 + SELL_MARKUP_PERCENT / 100)))
  })

  /** Rounded up, so the markup is never quietly smaller than the one advertised. */
  it('never quotes below the exact marked-up rate', () => {
    for (let market = 3_000; market <= 8_000; market += 7)
      expect(sellRate(market)).toBeGreaterThanOrEqual(market * (1 + SELL_MARKUP_PERCENT / 100))
  })

  it.each([0, -1])('answers zero for an unusable market rate (%p)', (market) => {
    expect(sellRate(market)).toBe(0)
  })
})

/**
 * The two together, which is where the product lives.
 *
 * Every screen, every settlement and the whole proposition depend on the buy
 * rate being the smaller number, and nothing about 46.27 and 47.43 makes that
 * obvious at a glance.
 */
describe('the two rates as a pair', () => {
  it('always puts the buy rate below the sell rate', () => {
    for (let market = 3_000; market <= 8_000; market += 7)
      expect(isSpreadOrdered(buyRate(market), sellRate(market))).toBe(true)
  })

  /**
   * The number the dashboard states. It is *not* the two percentages added up
   * — the second leg compounds on the first — which is exactly why nothing
   * outside the contracts is allowed to compute it.
   */
  it('reports a round trip worth more than either leg alone', () => {
    const profit = roundTripProfitPercent(buyRate(MARKET), sellRate(MARKET))

    expect(profit).toBeGreaterThan(BUY_DISCOUNT_PERCENT + SELL_MARKUP_PERCENT - 0.01)
    expect(profit).toBeCloseTo(2.51, 1)
  })

  /** Hryvnia in, hryvnia out: the user ends up with more than they started. */
  it('hands a round trip back more hryvnia than it took', () => {
    const startKopecks = 1_000_000
    const usdtCents = usdtCentsForKopecks(startKopecks, buyRate(MARKET), CentRounding.DOWN)
    const endKopecks = Math.round((usdtCents / 100) * sellRate(MARKET))

    expect(endKopecks).toBeGreaterThan(startKopecks)
  })

  it.each([0, -1])('reports no round-trip profit on an unusable rate (%p)', (market) => {
    expect(roundTripProfitPercent(buyRate(market), sellRate(market))).toBe(0)
  })
})

/**
 * The banner's other half. The percentage is the honest way to compare two
 * rates; the hryvnia figure is the one a reader can check by subtracting the
 * two numbers printed above it.
 */
describe('roundTripProfitKopecks', () => {
  it('is exactly the gap between the two rates', () => {
    expect(roundTripProfitKopecks(buyRate(MARKET), sellRate(MARKET))).toBe(
      sellRate(MARKET) - buyRate(MARKET)
    )
  })

  /** The two figures describe one fact, so they must never disagree in sign. */
  it('agrees with the percentage on every market rate', () => {
    for (let market = 3_000; market <= 8_000; market += 7) {
      const buy = buyRate(market)
      const sell = sellRate(market)

      expect(roundTripProfitKopecks(buy, sell)).toBeGreaterThan(0)
      expect(roundTripProfitPercent(buy, sell)).toBeGreaterThan(0)
    }
  })

  it.each([0, -1])('reports nothing gained on an unusable rate (%p)', (market) => {
    expect(roundTripProfitKopecks(buyRate(market), sellRate(market))).toBe(0)
  })
})
