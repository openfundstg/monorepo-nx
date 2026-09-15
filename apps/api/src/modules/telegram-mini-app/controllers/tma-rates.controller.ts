import { Controller, Get } from '@nestjs/common'
import { buyRate, sellRate, type TmaRatesResponse } from '@transacto/contracts'
import { Public } from 'src/modules/auth'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'

/**
 * Every price the Mini App displays, in one response.
 *
 * This replaced `GET /api/tma/exchange-rate`, which answered with one number.
 * A second rate then appeared — the discounted one a hryvnia top-up is credited
 * at — and adding a second endpoint for it would have meant two polls at two
 * cadences, so the dashboard and the top-up screen could disagree about the
 * market for as long as the gap between them. They are quoted together because
 * they are derived together: `fiatDeposit` is `market` less the channel
 * discount and `sell` is `market` plus the markup a sale is priced at, both
 * computed from the one cached figure, so the three are always internally
 * consistent even when they are a minute old.
 *
 * The client polls this every thirty seconds and holds the answer centrally.
 * That is cheaper than it sounds: `ExchangeRateService` answers from a
 * one-minute Redis cache and throws rather than inventing a fallback, so all
 * but the first caller in each window costs a single Redis read.
 *
 * Public: a price is not user-scoped, and the launch screen reads it before
 * `initData` has been validated.
 */
@Controller('tma/rates')
export class TmaRatesController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  /** GET /api/tma/rates */
  @Get()
  @Public()
  async getRates(): Promise<TmaRatesResponse> {
    const market = await this.exchangeRateService.getRate()

    // Both derived from the one figure already in hand rather than fetched
    // again: a second call could straddle a cache expiry and quote one leg
    // against a market the other leg never saw — and the difference between
    // these two numbers is what the dashboard advertises, so a pair taken a
    // minute apart would misstate it.
    //
    // The market itself is deliberately **not** in this response. It is the
    // input these two are derived from, not a price: a client that could see it
    // could quote it, and then there would be three answers to what a hryvnia
    // is worth.
    return {
      buy: buyRate(market),
      sell: sellRate(market)
    }
  }
}
