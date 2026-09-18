import { ERROR, saleStartParam } from '@transacto/contracts'
import { ConflictException } from '@nestjs/common'
import { SupportCardSaleService } from './support-card-sale.service'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import {
  SupportUserText,
  supportUserText
} from 'src/modules/support/constants/support-bot-text.constants'
import { SupportLocale } from 'src/shared/constants'
import type { SaleCardOrderService } from 'src/modules/telegram-mini-app'
import type { SupportUserService } from './support-user.service'
import type { TelegramBotApiService } from './telegram-bot.api.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TelegramCallbackQuery, TmaSaleCardOrderEvent } from 'src/shared/interfaces'

const TELEGRAM_ID = 592
const ORDER_ID = 1234567
const SALE_ID = '68cbf4a1c2d3e4f5a6b7c8d9'

const awaiting = (): TmaSaleCardOrderEvent => ({
  telegramId: TELEGRAM_ID,
  saleId: SALE_ID,
  publicId: 'Z38SL69F',
  orderId: ORDER_ID,
  amount: 142_800,
  confirmDeadlineAt: Date.now() + 300_000
})

const press = (data: string, from = TELEGRAM_ID): TelegramCallbackQuery =>
  ({
    id: 'q1',
    chat_instance: 'c1',
    from: { id: from, is_bot: false, first_name: 'Іван' },
    data
  }) as TelegramCallbackQuery

describe('SupportCardSaleService', () => {
  let sendMessage: jest.Mock
  let answerCallbackQuery: jest.Mock
  let cardOrders: { confirm: jest.Mock; deny: jest.Mock }
  let saleDb: { findByCardOrderId: jest.Mock }
  let service: SupportCardSaleService

  const username = process.env.TELEGRAM_BOT_USERNAME

  /** Every key on the message sent, whichever row it is on. */
  const sentKeys = (): { text: string; callback_data?: string; url?: string }[] =>
    (sendMessage.mock.calls[0][0].reply_markup?.inline_keyboard ?? []).flat()

  const replyText = (): string => sendMessage.mock.calls[0][0].text as string

  beforeEach(() => {
    process.env.TELEGRAM_BOT_USERNAME = 'transacto_bot'

    sendMessage = jest.fn().mockResolvedValue({ message_id: 1 })
    answerCallbackQuery = jest.fn().mockResolvedValue(true)
    cardOrders = {
      confirm: jest.fn().mockResolvedValue({}),
      deny: jest.fn().mockResolvedValue({})
    }
    saleDb = {
      findByCardOrderId: jest
        .fn()
        .mockResolvedValue({ _id: { toString: () => SALE_ID }, telegramId: TELEGRAM_ID })
    }

    service = new SupportCardSaleService(
      { sendMessage, answerCallbackQuery } as unknown as TelegramBotApiService,
      { localeFor: async () => SupportLocale.UK } as unknown as SupportUserService,
      cardOrders as unknown as SaleCardOrderService,
      saleDb as unknown as TmaSaleDbService
    )
  })

  afterEach(() => {
    // Restored key by key, never by reassigning `process.env`. `environments`
    // *is* that object — `export default process.env` — so replacing it leaves
    // every module reading a copy nothing writes to any more.
    if (username === undefined) delete process.env.TELEGRAM_BOT_USERNAME
    else process.env.TELEGRAM_BOT_USERNAME = username
  })

  describe('the keys under the question', () => {
    /**
     * **The bug this pins.** The key carried `t.me/<bot>` and nothing else,
     * which opens a bot chat rather than the Mini App — and this bot may not
     * even be the Mini App's, so it took the seller to a different chat with
     * nothing about their sale in it. To them the button simply did nothing.
     */
    it('points *Open the sale* at that sale inside the Mini App', async () => {
      await service.onOrderAwaiting(awaiting())

      const open = sentKeys().find((key) => key.url !== undefined)

      expect(open?.url).toBe(`https://t.me/transacto_bot?startapp=${saleStartParam(SALE_ID)}`)
    })

    /** A missing username costs the shortcut, never the message. */
    it('drops the key rather than the message when no username is configured', async () => {
      delete process.env.TELEGRAM_BOT_USERNAME

      await service.onOrderAwaiting(awaiting())

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(sentKeys().some((key) => key.url !== undefined)).toBe(false)
    })

    it('offers the confirm key with this order in its payload', async () => {
      await service.onOrderAwaiting(awaiting())

      expect(
        sentKeys().some(
          (key) => key.callback_data === `${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${ORDER_ID}`
        )
      ).toBe(true)
    })

    /**
     * Denying here would stop routing over a transfer still in flight, costing
     * the seller the rest of their own sale.
     */
    it('offers no deny key on a payment that has only just been routed', async () => {
      await service.onOrderAwaiting(awaiting())

      expect(
        sentKeys().some((key) =>
          key.callback_data?.startsWith(SupportConfig.CARD_SALE_DENY_PREFIX)
        )
      ).toBe(false)
    })
  })

  describe('answering a pressed key', () => {
    it('confirms the order the payload names', async () => {
      await service.handleAnswer(press(`${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${ORDER_ID}`))

      expect(cardOrders.confirm).toHaveBeenCalledWith(TELEGRAM_ID, SALE_ID, ORDER_ID)
    })

    it('denies through the same path', async () => {
      await service.handleAnswer(press(`${SupportConfig.CARD_SALE_DENY_PREFIX}${ORDER_ID}`))

      expect(cardOrders.deny).toHaveBeenCalledWith(TELEGRAM_ID, SALE_ID, ORDER_ID)
    })

    /**
     * `callback_data` is a string a client can edit, and a telegram id on a
     * callback arrives from Telegram rather than from a signed launch. Neither
     * may name somebody else's sale.
     */
    it('refuses a key pressed by somebody who does not own the sale', async () => {
      await service.handleAnswer(
        press(`${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${ORDER_ID}`, TELEGRAM_ID + 1)
      )

      expect(cardOrders.confirm).not.toHaveBeenCalled()
    })

    /**
     * The keys sit on a message that stays in the chat for ever, so one is
     * pressed on last week's notification — and Telegram answers `query is too
     * old` with a 400. Letting that escape would abort the whole update, and a
     * seller who pressed "money arrived" would not have.
     */
    it('carries on when the acknowledgement itself fails', async () => {
      answerCallbackQuery.mockRejectedValue(new Error('query is too old'))

      await service.handleAnswer(press(`${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${ORDER_ID}`))

      expect(cardOrders.confirm).toHaveBeenCalled()
    })

    /** A refusal is a sentence back, never silence — and never an exception. */
    it('tells the seller when the order can no longer be confirmed', async () => {
      cardOrders.confirm.mockRejectedValue(
        new ConflictException(ERROR.SALE_CARD.ORDER_NOT_EXECUTABLE)
      )

      await expect(
        service.handleAnswer(press(`${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${ORDER_ID}`))
      ).resolves.toBeUndefined()

      expect(replyText()).toBe(
        supportUserText(SupportUserText.CARD_ORDER_NOT_EXECUTABLE, SupportLocale.UK)
      )
    })

    it('ignores a payload this feature did not send', async () => {
      await service.handleAnswer(press('lang:uk'))

      expect(cardOrders.confirm).not.toHaveBeenCalled()
      expect(cardOrders.deny).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
    })
  })
})
