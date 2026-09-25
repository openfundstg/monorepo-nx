import {
  topUpCreditCents,
  type DepositConfigResponse,
  type FiatDepositOptionsResponse,
  type SaleConfigResponse
} from '@transacto/contracts'

/**
 * The pack's configs, re-priced at the rates the dashboard shows right now.
 *
 * The pack is priced once, at `/auth`, and the market moves every few minutes.
 * The sale form re-reads its config whenever the polled rate moves, so a pack
 * answering with the launch's rate would put one rate on the form and another
 * on the tile beside it — the one mismatch a viewer comparing two screens
 * catches. `null` — no poll has answered yet — keeps the pack's own figure.
 */
export const pricedSaleConfig = (
  config: SaleConfigResponse,
  liveSellRate: number | null
): SaleConfigResponse => ({ ...config, sellRate: liveSellRate ?? config.sellRate })

export const pricedDepositConfig = (
  config: DepositConfigResponse,
  liveBuyRate: number | null
): DepositConfigResponse => ({ ...config, exchangeRate: liveBuyRate ?? config.exchangeRate })

/** The top-up offer, each amount re-priced the way the server prices it. */
export const pricedFiatOffer = (
  offer: FiatDepositOptionsResponse,
  liveBuyRate: number | null
): FiatDepositOptionsResponse => {
  const rate = liveBuyRate ?? offer.exchangeRate

  return {
    ...offer,
    exchangeRate: rate,
    options: offer.options.map(({ amountUah }) => ({
      amountUah,
      cryptoCents: topUpCreditCents(amountUah, rate)
    }))
  }
}
