import { DEFAULT_MIN_ORDER_KOPECKS, parseMinOrderKopecks } from './min-order.util'

describe('parseMinOrderKopecks', () => {
  it('defaults when unset', () => {
    expect(parseMinOrderKopecks(undefined)).toBe(DEFAULT_MIN_ORDER_KOPECKS)
    expect(parseMinOrderKopecks('')).toBe(DEFAULT_MIN_ORDER_KOPECKS)
  })

  it('honours a configured width', () => {
    expect(parseMinOrderKopecks('50000')).toBe(50_000)
  })

  /**
   * Zero is a real answer — "nothing may be self-funded" — so it must survive
   * the falsy check that a naive `Number(x) || default` would fail.
   */
  it('honours zero', () => {
    expect(parseMinOrderKopecks('0')).toBe(0)
  })

  it('falls back rather than propagating something meaningless', () => {
    expect(parseMinOrderKopecks('not-a-number')).toBe(DEFAULT_MIN_ORDER_KOPECKS)
    expect(parseMinOrderKopecks('-1')).toBe(DEFAULT_MIN_ORDER_KOPECKS)
  })
})
