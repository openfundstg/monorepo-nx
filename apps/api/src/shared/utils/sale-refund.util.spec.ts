import { saleRefundSplit } from 'src/shared/utils'

/**
 * The arithmetic that decides how much of a stake comes back.
 *
 * It was private to `SaleCancelService` until the admin panel needed to
 * *show* the figure before paying it. Extracting it is only safe if the preview
 * and the settlement stay one implementation — which is what these assertions,
 * and the single call site in each, are for.
 */
describe('saleRefundSplit', () => {
  // ₴40.00 per USDT, so 100 kopecks = 2.5 USDT cents.
  const RATE = 4000

  it('returns the whole stake when the jar took nothing', () => {
    const split = saleRefundSplit({
      frozenUsdt: 15_000,
      exchangeRate: RATE,
      receivedAmount: 0,
      jarBalance: 0,
      openingJarBalance: 0
    })

    expect(split).toEqual({ refunded: 15_000, consumed: 0 })
  })

  it('keeps back what the jar already delivered', () => {
    // ₴87.00 delivered at ₴40/USDT is 2.175 USDT — 217 cents after rounding.
    const split = saleRefundSplit({
      frozenUsdt: 15_000,
      exchangeRate: RATE,
      receivedAmount: 8_700,
      jarBalance: null,
      openingJarBalance: null
    })

    expect(split.consumed).toBeGreaterThan(0)
    expect(split.refunded + split.consumed).toBe(15_000)
  })

  /**
   * Money can reach a jar without a settled order to attribute it to, and the
   * jar's own growth is what catches that. Refunding against `receivedAmount`
   * alone hands back money the user still has.
   */
  it('counts jar growth the matcher could not attribute', () => {
    const split = saleRefundSplit({
      frozenUsdt: 15_000,
      exchangeRate: RATE,
      receivedAmount: 0,
      jarBalance: 20_000,
      openingJarBalance: 8_000
    })

    // ₴120.00 of growth, none of it matched to an order.
    expect(split.consumed).toBe(300)
    expect(split.refunded).toBe(14_700)
  })

  it('ignores hryvnia that was in the jar before the order started', () => {
    // A user may point an order at a jar that already holds money, and that
    // money was theirs before any of this began.
    const split = saleRefundSplit({
      frozenUsdt: 15_000,
      exchangeRate: RATE,
      receivedAmount: 0,
      jarBalance: 50_000,
      openingJarBalance: 50_000
    })

    expect(split).toEqual({ refunded: 15_000, consumed: 0 })
  })

  it('never refunds more than the stake, however much the jar reports', () => {
    const split = saleRefundSplit({
      frozenUsdt: 1_000,
      exchangeRate: RATE,
      receivedAmount: 900_000,
      jarBalance: null,
      openingJarBalance: null
    })

    expect(split.consumed).toBe(1_000)
    expect(split.refunded).toBe(0)
  })

  it('always splits the stake exactly, with nothing created or lost', () => {
    for (const received of [0, 1, 5_000, 8_700, 150_000, 999_999]) {
      const split = saleRefundSplit({
        frozenUsdt: 15_000,
        exchangeRate: RATE,
        receivedAmount: received,
        jarBalance: null,
        openingJarBalance: null
      })

      expect(split.refunded + split.consumed).toBe(15_000)
      expect(split.refunded).toBeGreaterThanOrEqual(0)
      expect(split.consumed).toBeGreaterThanOrEqual(0)
    }
  })
})
