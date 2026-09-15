import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import Redis from 'ioredis'
import { ERROR, KOPECKS_PER_UAH, buyRate, sellRate } from '@transacto/contracts'
import { REDIS_CLIENT } from 'src/shared/redis'
import { TransactoPanelApiService } from 'src/modules/transacto/services/transacto-panel.api.service'

const CACHE_KEY = 'tma:exchange_rate:usdt_uah'
const CACHE_TTL_SECONDS = 60

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name)

  constructor(
    private readonly transactoPanelApiService: TransactoPanelApiService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * The USDT→UAH rate we quote, in kopecks (4491 = 44.91 UAH).
   *
   * **The source is Transacto's own panel**, the price our counterparty
   * publishes, and it is taken as given rather than adjusted. It previously
   * came from Binance's `USDTUAH` ticker less a configured margin, which meant
   * we priced against a market Transacto does not settle on: in one sample
   * Binance said 46.41 while the panel said 44.91, and that ~3% was ours to
   * eat in whichever direction it moved. Transacto's figure already carries
   * their spread, so applying ours on top would take it twice — which is why
   * `EXCHANGE_RATE_MARGIN_PERCENT` is gone rather than merely defaulted to 0.
   *
   * Everything downstream — a deposit's credit, a sale's stake, the
   * figure on the dashboard — is priced off this one number. Deposits and
   * sales used to disagree, taking the live market and a hand-written
   * env var respectively, so a user could buy USDT at one price and stake it at
   * another.
   *
   * Strategy:
   * 1. Redis cache (1-min TTL)
   * 2. On a miss → the Transacto panel
   * 3. On failure → throw
   *
   * Step 3 is the whole point. There is deliberately no fallback source: a rate
   * is a *price*, multiplied by a user's crypto and then frozen onto the
   * deposit or order for good. A second source does not degrade gracefully —
   * it quotes a different number, so the price would depend on which system
   * happened to answer. Refusing to quote costs a retry; quoting a wrong price
   * costs money.
   *
   * Callers hold nothing at this point — this runs before any balance is
   * frozen or credited — so a throw strands nothing. Money already in flight
   * settles against the rate snapshotted on its own document and never comes
   * back here.
   */
  async getRate(): Promise<number> {
    const cached = await this.redis.get(CACHE_KEY)
    if (cached) {
      return Number(cached)
    }

    const rateUah = await this.transactoPanelApiService.getCurrentRateUah()
    const rateKopecks = Math.round(rateUah * KOPECKS_PER_UAH)

    if (!Number.isFinite(rateKopecks) || rateKopecks <= 0) {
      this.logger.error(`Transacto panel quoted an unusable USDT/UAH rate: ${rateUah}`)
      throw new ServiceUnavailableException(ERROR.EXCHANGE_RATE.UNAVAILABLE)
    }

    await this.redis.set(CACHE_KEY, rateKopecks.toString(), 'EX', CACHE_TTL_SECONDS)

    this.logger.debug(`Transacto panel USDT/UAH rate: ${rateUah} UAH (${rateKopecks} kopecks)`)

    return rateKopecks
  }

  /**
   * The rate a **hryvnia top-up** is credited at, in kopecks per USDT.
   *
   * The market rate less the fiat channel's discount, and always the smaller
   * number: settling somebody's payout is the route that earns us a commission,
   * so it is priced better than sending coin we already hold.
   *
   * Derived here rather than at each call site, and by the contract's own
   * function rather than by a multiplication written out again. Three things
   * quote this figure — the offer, the reservation that freezes it, and the
   * rates poll the Mini App shows it from — and they have to agree to the
   * kopeck or the confirmation dialog contradicts the list behind it.
   */
  async getBuyRate(): Promise<number> {
    return buyRate(await this.getRate())
  }

  /**
   * The other of the two, so nothing outside this service turns a market figure
   * into a price.
   *
   * `getRate()` stays public because the two derivations here need it and the
   * cache lives behind it — but a caller reaching for it to quote something is
   * the bug this pair exists to make unnecessary.
   */
  async getSellRate(): Promise<number> {
    return sellRate(await this.getRate())
  }

  /**
   * Both prices, derived from **one** reading of the market.
   *
   * For anything that shows the pair side by side. Calling the two getters
   * instead is not the same thing: each reaches `getRate()` on its own, and two
   * concurrent calls can both miss the one-minute cache, fetch separately and
   * come back with different market figures — a spread computed across two
   * moments, printed as if it were one. The whole point of showing them
   * together is that their difference means something.
   */
  async getSpread(): Promise<{ buy: number; sell: number }> {
    const market = await this.getRate()

    return { buy: buyRate(market), sell: sellRate(market) }
  }

  /**
   * Returns rate in human-readable UAH (e.g., 44.91).
   */
  async getRateUah(): Promise<number> {
    const kopecks = await this.getRate()
    return kopecks / KOPECKS_PER_UAH
  }
}
