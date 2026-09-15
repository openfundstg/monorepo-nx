import { BadRequestException } from '@nestjs/common'
import { ERROR, FiatDepositWatchMode } from '@transacto/contracts'
import { FiatDepositWatchService } from './fiat-deposit-watch.service'
import { FiatDepositCeilingService } from './fiat-deposit-ceiling.service'
import {
  fiatDepositRecord,
  fiatDepositWatchRecord,
  TEST_RATE_KOPECKS,
  TEST_TELEGRAM_ID
} from 'src/modules/telegram-mini-app/testing'
import { NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH } from 'src/shared/constants'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import type { ExchangeRateService } from 'src/modules/exchange-rate/services'
import type { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaFiatDepositWatchDbService } from 'src/modules/repositories/tma-fiat-deposit-watch-db/services'
import type { TmaFiatDepositAmountsAvailableEvent } from 'src/shared/interfaces'

/** ₴1 000 and ₴2 500 in kopecks — inside the fixture's ₴500–₴3 000 range. */
const IN_RANGE = [100_000, 250_000]

describe('FiatDepositWatchService', () => {
  let watchDb: {
    findByTelegramId: jest.Mock
    save: jest.Mock
    removeByTelegramId: jest.Mock
    findOverlapping: jest.Mock
  }
  let fiatDepositDb: { findActiveByTelegramId: jest.Mock; hasCompleted: jest.Mock }
  let depositDb: { hasCredited: jest.Mock }
  let emit: jest.Mock
  let service: FiatDepositWatchService

  /** Every event emitted on the amounts channel, as the listener would see it. */
  const announced = (): TmaFiatDepositAmountsAvailableEvent[] =>
    emit.mock.calls
      .filter(([channel]) => channel === TMA_DOMAIN_EVENT.FIAT_DEPOSIT_AMOUNTS_AVAILABLE)
      .map(([, event]) => event as TmaFiatDepositAmountsAvailableEvent)

  beforeEach(() => {
    watchDb = {
      findByTelegramId: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (telegramId, data) =>
        fiatDepositWatchRecord({ telegramId, ...data })
      ),
      removeByTelegramId: jest.fn().mockResolvedValue(true),
      findOverlapping: jest.fn().mockResolvedValue([fiatDepositWatchRecord()])
    }
    // Nothing held, nothing ever credited — the capped new account every user
    // arrives as.
    fiatDepositDb = {
      findActiveByTelegramId: jest.fn().mockResolvedValue(null),
      hasCompleted: jest.fn().mockResolvedValue(false)
    }
    depositDb = { hasCredited: jest.fn().mockResolvedValue(false) }
    emit = jest.fn()

    service = new FiatDepositWatchService(
      watchDb as unknown as TmaFiatDepositWatchDbService,
      fiatDepositDb as unknown as TmaFiatDepositDbService,
      // The real ceiling rule rather than a stub, so the offer and this cannot
      // come to two answers about the same account.
      new FiatDepositCeilingService(
        depositDb as unknown as TmaDepositDbService,
        fiatDepositDb as unknown as TmaFiatDepositDbService
      ),
      { getBuyRate: async () => TEST_RATE_KOPECKS } as unknown as ExchangeRateService,
      { emit } as unknown as EventEmitter2
    )
  })

  describe('saving a request', () => {
    it('stores the range the user asked for', async () => {
      const saved = await service.save(TEST_TELEGRAM_ID, {
        minAmountUah: 100_000,
        maxAmountUah: 200_000,
        mode: FiatDepositWatchMode.ONCE
      })

      expect(watchDb.save).toHaveBeenCalledWith(TEST_TELEGRAM_ID, {
        minAmountUah: 100_000,
        maxAmountUah: 200_000,
        mode: FiatDepositWatchMode.ONCE
      })
      expect(saved.mode).toBe(FiatDepositWatchMode.ONCE)
      expect(saved.lastNotifiedAt).toBeNull()
    })

    it('refuses a range that runs backwards', async () => {
      await expect(
        service.save(TEST_TELEGRAM_ID, {
          minAmountUah: 200_000,
          maxAmountUah: 100_000,
          mode: FiatDepositWatchMode.ALWAYS
        })
      ).rejects.toMatchObject({ response: ERROR.FIAT_DEPOSIT.WATCH_RANGE_INVALID })
      expect(watchDb.save).not.toHaveBeenCalled()
    })

    /**
     * A range whose top buys less than the product's minimum USDT describes
     * sums the offer would drop even from a full book — so the request could
     * only ever be a promise to call somebody who would never be called.
     */
    it('refuses a range beneath the product’s own floor', async () => {
      await expect(
        service.save(TEST_TELEGRAM_ID, {
          minAmountUah: 100,
          maxAmountUah: 200,
          mode: FiatDepositWatchMode.ALWAYS
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(watchDb.save).not.toHaveBeenCalled()
    })

    it('refuses a range that starts above this account’s ceiling', async () => {
      await expect(
        service.save(TEST_TELEGRAM_ID, {
          minAmountUah: NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH + 100,
          maxAmountUah: NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH * 2,
          mode: FiatDepositWatchMode.ALWAYS
        })
      ).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.WATCH_ABOVE_FIRST_DEPOSIT_LIMIT
      })
    })

    /** One credited deposit lifts the cap, so the same range is then fine. */
    it('accepts that range once the account has a credited deposit', async () => {
      depositDb.hasCredited.mockResolvedValue(true)

      await expect(
        service.save(TEST_TELEGRAM_ID, {
          minAmountUah: NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH + 100,
          maxAmountUah: NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH * 2,
          mode: FiatDepositWatchMode.ALWAYS
        })
      ).resolves.toBeDefined()
    })
  })

  describe('announcing', () => {
    it('tells a user about the amounts inside their range, cheapest first', async () => {
      depositDb.hasCredited.mockResolvedValue(true)

      await service.announce([250_000, 100_000, 900_000])

      expect(announced()).toEqual([
        expect.objectContaining({ telegramId: TEST_TELEGRAM_ID, amountsUah: IN_RANGE })
      ])
    })

    /**
     * The floor the offer applies, applied here too. A range of ₴1–₴3 000 is a
     * legitimate request, and a ₴300 payout falls inside it — but buys less
     * than the product's minimum USDT, so the list never shows it and `reserve`
     * refuses it. A message about one points at a screen showing nothing.
     */
    it('never announces an amount the top-up screen would not list', async () => {
      depositDb.hasCredited.mockResolvedValue(true)
      watchDb.findOverlapping.mockResolvedValue([
        fiatDepositWatchRecord({ minAmountUah: 100, maxAmountUah: 300_000 })
      ])

      // ₴300 at 44.91 is 6.68 USDT — under the ten-USDT floor.
      await service.announce([30_000, 100_000])

      expect(announced()[0].amountsUah).toEqual([100_000])
    })

    it('asks the book for nothing when every new amount is below the floor', async () => {
      await service.announce([30_000])

      expect(watchDb.findOverlapping).not.toHaveBeenCalled()
      expect(announced()).toEqual([])
    })

    it('says nothing when no new amount is in range', async () => {
      await service.announce([900_000])

      expect(announced()).toEqual([])
    })

    it('asks for nothing at all when nothing appeared', async () => {
      await service.announce([])

      expect(watchDb.findOverlapping).not.toHaveBeenCalled()
    })

    /**
     * A user holding a top-up cannot reserve a second one, so a message about
     * an amount is a message about something the product would refuse.
     */
    it('skips somebody who already holds a top-up', async () => {
      fiatDepositDb.findActiveByTelegramId.mockResolvedValue(fiatDepositRecord())

      await service.announce(IN_RANGE)

      expect(announced()).toEqual([])
    })

    /**
     * The range was inside the ceiling when it was saved; an amount inside the
     * range need not be. Telling a capped account about ₴5 000 sends them to a
     * list that does not show it.
     */
    it('drops amounts above the account’s ceiling', async () => {
      watchDb.findOverlapping.mockResolvedValue([
        fiatDepositWatchRecord({ minAmountUah: 50_000, maxAmountUah: 1_000_000 })
      ])

      await service.announce([100_000, NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH + 100])

      expect(announced()[0].amountsUah).toEqual([100_000])
    })

    it('says nothing when every match is above the ceiling', async () => {
      watchDb.findOverlapping.mockResolvedValue([
        fiatDepositWatchRecord({
          minAmountUah: NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH + 100,
          maxAmountUah: 1_000_000
        })
      ])

      await service.announce([NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH + 100])

      expect(announced()).toEqual([])
    })

    /**
     * It runs inside the cron that keeps the offer alive for everyone. A
     * database it cannot reach must cost the people waiting on a sum their
     * message, and nobody else their screen.
     */
    it('never lets a failure escape into the refresh', async () => {
      watchDb.findOverlapping.mockRejectedValue(new Error('mongo is down'))

      await expect(service.announce(IN_RANGE)).resolves.toBeUndefined()
    })

    /** The consumer settles the request; nothing here retires anything. */
    it('leaves the request alone — the sender decides what happened to it', async () => {
      depositDb.hasCredited.mockResolvedValue(true)

      await service.announce(IN_RANGE)

      expect(watchDb.removeByTelegramId).not.toHaveBeenCalled()
    })
  })
})
