import { HttpException } from '@nestjs/common'
import { FiatDepositWatchMode } from '@transacto/contracts'
import { SupportFiatWatchService } from './support-fiat-watch.service'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import { SupportLocale } from 'src/shared/constants'
import { formatUahKopecks } from 'src/modules/support/utils'
import { TelegramFailure } from 'src/shared/utils'
import type { SupportUserService } from './support-user.service'
import type { TelegramBotApiService } from './telegram-bot.api.service'
import type { TmaFiatDepositWatchDbService } from 'src/modules/repositories/tma-fiat-deposit-watch-db/services'
import type { TelegramCallbackQuery, TmaFiatDepositAmountsAvailableEvent } from 'src/shared/interfaces'

const WATCH_ID = '6aa1fcd77c31d783a2238fa7'
const TELEGRAM_ID = 592

const amountsAvailable = (
  overrides: Partial<TmaFiatDepositAmountsAvailableEvent> = {}
): TmaFiatDepositAmountsAvailableEvent => ({
  watchId: WATCH_ID,
  telegramId: TELEGRAM_ID,
  amountsUah: [100_000],
  minAmountUah: 50_000,
  maxAmountUah: 300_000,
  mode: FiatDepositWatchMode.ALWAYS,
  ...overrides
})

/** What `TelegramBotApiService` throws: the verdict, never the axios error. */
const telegramRefusal = (failure: TelegramFailure) =>
  new HttpException({ code: 1, message: 'refused', failure }, 403)

describe('SupportFiatWatchService', () => {
  let sendMessage: jest.Mock
  let answerCallbackQuery: jest.Mock
  let watchDb: { removeById: jest.Mock; markNotified: jest.Mock; removeByTelegramId: jest.Mock }
  let service: SupportFiatWatchService

  /** The text of the one message sent, for assertions about what it says. */
  const sentText = (): string => sendMessage.mock.calls[0][0].text as string

  const sentKeys = (): { text: string; callback_data?: string; url?: string }[] =>
    sendMessage.mock.calls[0][0].reply_markup?.inline_keyboard?.[0] ?? []

  beforeEach(() => {
    sendMessage = jest.fn().mockResolvedValue({ message_id: 1 })
    answerCallbackQuery = jest.fn().mockResolvedValue(true)
    watchDb = {
      removeById: jest.fn().mockResolvedValue(undefined),
      markNotified: jest.fn().mockResolvedValue(undefined),
      removeByTelegramId: jest.fn().mockResolvedValue(true)
    }

    service = new SupportFiatWatchService(
      { sendMessage, answerCallbackQuery } as unknown as TelegramBotApiService,
      { localeFor: async () => SupportLocale.UK } as unknown as SupportUserService,
      watchDb as unknown as TmaFiatDepositWatchDbService
    )
  })

  describe('calling a user back', () => {
    it('names every amount that arrived', async () => {
      await service.onAmountsAvailable(amountsAvailable({ amountsUah: [100_000, 250_000] }))

      // Through the bot's own formatter rather than a literal: `uk-UA` groups
      // with a non-breaking space, and a hand-typed `1 000` does not match it.
      expect(sentText()).toContain(formatUahKopecks(100_000))
      expect(sentText()).toContain(formatUahKopecks(250_000))
    })

    /**
     * The request outlives the message it produced, so the key has something to
     * cancel — and the stamp is what the panel sorts on to find ranges nobody
     * has ever been able to fill.
     */
    it('stamps a standing request and leaves it in place', async () => {
      await service.onAmountsAvailable(amountsAvailable())

      expect(watchDb.markNotified).toHaveBeenCalledWith(WATCH_ID, expect.any(Date))
      expect(watchDb.removeById).not.toHaveBeenCalled()
      expect(sentKeys().some((key) => key.callback_data === SupportConfig.FIAT_WATCH_OFF_CALLBACK)).toBe(
        true
      )
    })

    /**
     * A one-off is spent by the message that answers it, so there is nothing
     * left to unsubscribe from — and a key offering to could only ever answer
     * "there was nothing to cancel".
     */
    it('retires a one-off request and offers no unsubscribe key', async () => {
      await service.onAmountsAvailable(amountsAvailable({ mode: FiatDepositWatchMode.ONCE }))

      expect(watchDb.removeById).toHaveBeenCalledWith(WATCH_ID)
      expect(watchDb.markNotified).not.toHaveBeenCalled()
      expect(sentKeys().some((key) => key.callback_data === SupportConfig.FIAT_WATCH_OFF_CALLBACK)).toBe(
        false
      )
    })

    /**
     * The one failure this feature must never produce: a request retired for a
     * call that was never made.
     */
    it('leaves the request alone when the message did not go', async () => {
      sendMessage.mockRejectedValue(telegramRefusal(TelegramFailure.RATE_LIMITED))

      await service.onAmountsAvailable(amountsAvailable())

      expect(watchDb.markNotified).not.toHaveBeenCalled()
      expect(watchDb.removeById).not.toHaveBeenCalled()
    })

    /**
     * …with one exception. A user who blocked the bot can never be told
     * anything again, so retrying every twenty seconds for as long as the book
     * moves is a promise nothing can keep.
     */
    it.each([[TelegramFailure.BLOCKED_BY_USER], [TelegramFailure.USER_DEACTIVATED]])(
      'drops the request of a user who is unreachable (%s)',
      async (failure: TelegramFailure) => {
        sendMessage.mockRejectedValue(telegramRefusal(failure))

        await service.onAmountsAvailable(amountsAvailable())

        expect(watchDb.removeById).toHaveBeenCalledWith(WATCH_ID)
      }
    )

    /**
     * The inverse of the invariant, and the one the first cut got wrong: the
     * message went, the database did not answer, and the failure was reported
     * as "could not tell them" while a `ONCE` request stayed alive to message
     * the same person again on the next arrival.
     */
    it('does not resurrect a one-off request when only the settle failed', async () => {
      watchDb.removeById.mockRejectedValue(new Error('mongo is down'))

      await service.onAmountsAvailable(amountsAvailable({ mode: FiatDepositWatchMode.ONCE }))

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(watchDb.removeById).toHaveBeenCalledWith(WATCH_ID)
    })

    /**
     * The state a Mini App user reaches simply by opening the app from a link:
     * Telegram will not let a bot write first to somebody who never started it.
     * On 2026-09-10 that was 8 of 37 users. Left unclassified it reads as a
     * passing error, so the request survives and retries on every book movement
     * for as long as the app runs.
     */
    it('drops the request of somebody who never started the bot', async () => {
      sendMessage.mockRejectedValue(telegramRefusal(TelegramFailure.CANNOT_INITIATE))

      await service.onAmountsAvailable(amountsAvailable())

      expect(watchDb.removeById).toHaveBeenCalledWith(WATCH_ID)
    })

    /**
     * A rate limit is the one failure where waiting is the whole remedy — and
     * the amount is already in the snapshot, so it is never diffed as new
     * again. Giving up loses the notification rather than deferring it.
     */
    it('waits and sends again when Telegram asks it to slow down', async () => {
      jest.useFakeTimers()

      try {
        sendMessage
          .mockRejectedValueOnce(telegramRefusal(TelegramFailure.RATE_LIMITED))
          .mockResolvedValue({ message_id: 2 })

        const sending = service.onAmountsAvailable(amountsAvailable())
        await jest.advanceTimersByTimeAsync(1_000)
        await sending

        expect(sendMessage).toHaveBeenCalledTimes(2)
        // The retry landed, so the request is settled — an earlier cut returned
        // on the first refusal and left it unsettled even when the retry worked.
        expect(watchDb.markNotified).toHaveBeenCalledWith(WATCH_ID, expect.any(Date))
      } finally {
        jest.useRealTimers()
      }
    })

    it('gives up after one retry rather than becoming a queue', async () => {
      jest.useFakeTimers()

      try {
        sendMessage.mockRejectedValue(telegramRefusal(TelegramFailure.RATE_LIMITED))

        const sending = service.onAmountsAvailable(amountsAvailable())
        await jest.advanceTimersByTimeAsync(60_000)
        await sending

        expect(sendMessage).toHaveBeenCalledTimes(2)
        expect(watchDb.markNotified).not.toHaveBeenCalled()
        expect(watchDb.removeById).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    it('never throws — it runs off the book refresh', async () => {
      sendMessage.mockRejectedValue(new Error('socket hang up'))
      watchDb.markNotified.mockRejectedValue(new Error('mongo is down'))

      await expect(service.onAmountsAvailable(amountsAvailable())).resolves.toBeUndefined()
    })
  })

  describe('the unsubscribe key', () => {
    const query = { id: 'q1', from: { id: TELEGRAM_ID } } as TelegramCallbackQuery

    /** Until the query is answered the client spins, and a spinning key gets pressed again. */
    it('answers the query before anything else', async () => {
      await service.handleUnsubscribe(query)

      expect(answerCallbackQuery).toHaveBeenCalledWith({ callback_query_id: query.id })
      expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
        sendMessage.mock.invocationCallOrder[0]
      )
    })

    /**
     * The key lives on a message that never leaves the chat, so it is pressed
     * on last week's notification — and Telegram answers `query is too old`
     * with a 400 the transport rethrows. Letting that escape aborted the whole
     * update, so the removal never ran, the webhook redelivered and failed the
     * same way, and somebody who pressed unsubscribe stayed subscribed.
     */
    it('still unsubscribes when the query is too old to acknowledge', async () => {
      answerCallbackQuery.mockRejectedValue(
        new HttpException({ code: 1, message: 'query is too old' }, 400)
      )

      await expect(service.handleUnsubscribe(query)).resolves.toBeUndefined()

      expect(watchDb.removeByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID)
    })

    /**
     * The acknowledgement is already spent by the time the removal runs, so an
     * exception escaping into the webhook buys nothing: Telegram redelivers,
     * the stale ack fails, and the user stays subscribed.
     */
    it('does not throw into the webhook when the database is unwell', async () => {
      watchDb.removeByTelegramId.mockRejectedValue(new Error('mongo is down'))

      await expect(service.handleUnsubscribe(query)).resolves.toBeUndefined()
    })

    it('cancels the presser’s own request and confirms it', async () => {
      await service.handleUnsubscribe(query)

      expect(watchDb.removeByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID)
      expect(sentText()).toContain('більше не повідомлятимемо')
    })

    /**
     * The key lives on a message that stays in the chat forever, so it is
     * pressed on last week's notification by somebody who unsubscribed days ago.
     */
    it('says so plainly when there was nothing left to cancel', async () => {
      watchDb.removeByTelegramId.mockResolvedValue(false)

      await service.handleUnsubscribe(query)

      expect(sentText()).toContain('вже немає')
    })
  })
})
