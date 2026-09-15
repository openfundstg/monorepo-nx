import { ServiceUnavailableException } from '@nestjs/common'
import { ExchangeRateService } from './exchange-rate.service'
import type Redis from 'ioredis'
import type { TransactoPanelApiService } from 'src/modules/transacto/services/transacto-panel.api.service'

/** What the panel answered on the day this was wired up: ₴44.91 per USDT. */
const PANEL_RATE_UAH = 44.91

describe('ExchangeRateService', () => {
  let getCurrentRateUah: jest.Mock
  let redis: { get: jest.Mock; set: jest.Mock }
  let service: ExchangeRateService

  beforeEach(() => {
    getCurrentRateUah = jest.fn().mockResolvedValue(PANEL_RATE_UAH)
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }

    service = new ExchangeRateService(
      { getCurrentRateUah } as unknown as TransactoPanelApiService,
      redis as unknown as Redis
    )
  })

  /**
   * The rate is quoted exactly as Transacto publishes it. Their figure already
   * carries their spread — it sat ~3% under Binance in the same minute — so a
   * margin of ours on top would take it twice.
   */
  it('quotes the panel price as given, in kopecks', async () => {
    await expect(service.getRate()).resolves.toBe(4491)
  })

  it('does not shave anything off the published price', async () => {
    await expect(service.getRate()).resolves.toBe(Math.round(PANEL_RATE_UAH * 100))
  })

  it('rounds a fractional kopeck rather than truncating it', async () => {
    getCurrentRateUah.mockResolvedValue(44.916)

    await expect(service.getRate()).resolves.toBe(4492)
  })

  it('caches the quoted rate so every product reads one number', async () => {
    const quoted = await service.getRate()

    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      quoted.toString(),
      'EX',
      expect.any(Number)
    )
  })

  it('serves the cached figure without asking the panel again', async () => {
    redis.get.mockResolvedValue('4491')

    await expect(service.getRate()).resolves.toBe(4491)
    expect(getCurrentRateUah).not.toHaveBeenCalled()
  })

  /**
   * There is deliberately no second source behind this. A rate is a price, and
   * a fallback quotes a different one — so what a user paid would depend on
   * which system happened to answer.
   */
  it('refuses to quote when the panel cannot be reached', async () => {
    getCurrentRateUah.mockRejectedValue(new ServiceUnavailableException())

    await expect(service.getRate()).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(redis.set).not.toHaveBeenCalled()
  })

  /**
   * A price of zero would credit a deposit with nothing and divide a sale's
   * stake by nought. Refusing is the only safe answer.
   */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to quote a rate of %p',
    async (rate) => {
      getCurrentRateUah.mockResolvedValue(rate)

      await expect(service.getRate()).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(redis.set).not.toHaveBeenCalled()
    }
  )

  it('reports the same figure in hryvnia', async () => {
    await expect(service.getRateUah()).resolves.toBe(44.91)
  })
})
