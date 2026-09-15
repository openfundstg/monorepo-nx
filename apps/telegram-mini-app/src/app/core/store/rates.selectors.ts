import { createFeatureSelector, createSelector } from '@ngrx/store'
import { roundTripProfitKopecks, roundTripProfitPercent } from '@transacto/contracts'
import { RATES_FEATURE, type RatesState } from './rates.state'

const selectRates = createFeatureSelector<RatesState>(RATES_FEATURE)

/** Kopecks per USDT when acquiring USDT, or `null` until the first poll answers. */
export const selectBuyRate = createSelector(selectRates, (state) => state.buy)

/** Kopecks per USDT when selling USDT, or `null` until the first poll answers. */
export const selectSellRate = createSelector(selectRates, (state) => state.sell)

/**
 * What a round trip through both rates earns, in percent — the dashboard's
 * headline, and the product's whole proposition in one number.
 *
 * Derived from the two rates by the shared helper rather than computed here or
 * written down anywhere: it is not the two spreads added up, and a screen that
 * knew enough to add them would be a screen that knew the spreads.
 *
 * `null` while either rate is unknown, so the banner is absent rather than
 * promising nothing.
 */
export const selectRoundTripProfitPercent = createSelector(
  selectBuyRate,
  selectSellRate,
  (buy, sell) => (buy === null || sell === null ? null : roundTripProfitPercent(buy, sell))
)

/**
 * The same round trip in kopecks per USDT — the difference between the two
 * rates, which a reader can check against the two numbers on screen.
 *
 * `null` while either rate is unknown, in step with the percentage: the banner
 * states both or neither.
 */
export const selectRoundTripProfitKopecks = createSelector(
  selectBuyRate,
  selectSellRate,
  (buy, sell) => (buy === null || sell === null ? null : roundTripProfitKopecks(buy, sell))
)
