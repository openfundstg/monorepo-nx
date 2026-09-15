import { SupportMenuService } from './support-menu.service'
import { SupportLocale } from 'src/shared/constants'
import { SupportButton } from 'src/modules/support/enums'
import type { TelegramUser } from 'src/shared/interfaces'

const USER_ID = 501_234_567

const user = (over: Record<string, unknown> = {}): TelegramUser =>
  ({ id: USER_ID, is_bot: false, first_name: 'Іван', ...over }) as TelegramUser

const lastMessage = (api: Record<string, jest.Mock>) => api.sendMessage.mock.calls.at(-1)?.[0]

describe('SupportMenuService', () => {
  let api: Record<string, jest.Mock>
  let users: { setLocale: jest.Mock }
  let accounts: { findByTelegramId: jest.Mock }
  let rates: { getSpread: jest.Mock }
  let service: SupportMenuService

  const build = () =>
    new SupportMenuService(api as never, users as never, accounts as never, rates as never)

  beforeEach(() => {
    api = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
      answerCallbackQuery: jest.fn().mockResolvedValue(true)
    }
    users = { setLocale: jest.fn().mockResolvedValue(undefined) }
    accounts = { findByTelegramId: jest.fn().mockResolvedValue(null) }
    // A real spread: the market at ₴46.00, less 0.5% to buy and plus 2% to
    // sell — one read, both figures, as `getSpread` guarantees.
    rates = { getSpread: jest.fn().mockResolvedValue({ buy: 4_577, sell: 4_692 }) }
    service = build()
  })

  /**
   * Telegram keeps a persistent keyboard until something replaces it, but a
   * user who cleared theirs — or who was here before the keyboard existed —
   * would have no way back to it.
   */
  it('attaches the keyboard to every line it writes', async () => {
    await service.sendGreeting(user(), SupportLocale.UK)

    expect(lastMessage(api).reply_markup).toMatchObject({ is_persistent: true })
  })

  describe('balance', () => {
    it('shows the three pots the dashboard shows', async () => {
      accounts.findByTelegramId.mockResolvedValue({
        balance: 123_456,
        frozenBalance: 1_000,
        referralBalance: 120,
        totalTurnover: 4_500_000
      })

      await service.handleButton(SupportButton.BALANCE, user(), SupportLocale.UK)

      expect(lastMessage(api).text).toContain('234,56 USDT')
      expect(lastMessage(api).text).toContain('10,00 USDT')
    })

    it('adds what the user has sold and both prices, with the gap between them', async () => {
      accounts.findByTelegramId.mockResolvedValue({
        balance: 100,
        frozenBalance: 0,
        referralBalance: 0,
        totalTurnover: 4_500_000
      })

      await service.handleButton(SupportButton.BALANCE, user(), SupportLocale.UK)

      const text = lastMessage(api).text as string

      expect(text).toContain('45\u00a0000,00 грн')
      expect(text).toContain('45,77 грн')
      expect(text).toContain('46,92 грн')
      // 4692 − 4577, and the same round trip as a percentage.
      expect(text).toContain('1,15 грн')
      expect(text).toContain('2,5%')
    })

    /**
     * One read of the market, not two. Two would each reach `getRate` on their
     * own, both can miss the one-minute cache, and the difference printed
     * underneath them would then span two moments.
     */
    it('takes both prices from a single reading of the market', async () => {
      accounts.findByTelegramId.mockResolvedValue({
        balance: 100,
        frozenBalance: 0,
        referralBalance: 0,
        totalTurnover: 0
      })

      await service.handleButton(SupportButton.BALANCE, user(), SupportLocale.UK)

      expect(rates.getSpread).toHaveBeenCalledTimes(1)
    })

    /**
     * `ExchangeRateService` refuses to quote rather than guess, which is right
     * where money is priced — and wrong here. This card prices nothing, so a
     * panel outage must cost the rate line, not the balance.
     */
    it('still shows the balance when the market cannot be reached', async () => {
      accounts.findByTelegramId.mockResolvedValue({
        balance: 100,
        frozenBalance: 0,
        referralBalance: 0,
        totalTurnover: 0
      })
      rates.getSpread.mockRejectedValueOnce(new Error('panel is down'))

      await service.handleButton(SupportButton.BALANCE, user(), SupportLocale.UK)

      expect(lastMessage(api).text).toContain('1,00 USDT')
      expect(lastMessage(api).text).toContain('Курси тимчасово недоступні')
    })

    /**
     * Anyone can message a bot; an account only exists once the Mini App has
     * been opened. That is a normal state — and a zero would be a lie about
     * somebody's money.
     */
    it('explains itself rather than showing a zero to somebody with no account', async () => {
      await service.handleButton(SupportButton.BALANCE, user(), SupportLocale.EN)

      expect(lastMessage(api).text).toContain('no Open Funds account')
    })
  })

  describe('language', () => {
    /** Until the query is answered the client spins on the key for a minute. */
    it('answers the callback before doing anything else', async () => {
      await service.handleLanguageChoice({ id: 'q1', data: 'lang:en', from: user() } as never)

      expect(api.answerCallbackQuery).toHaveBeenCalledWith({ callback_query_id: 'q1' })
      expect(users.setLocale).toHaveBeenCalledWith(USER_ID, SupportLocale.EN)
    })

    /** The confirmation is the one message that must be readable to the newcomer. */
    it('confirms in the newly chosen language, with a keyboard to match', async () => {
      await service.handleLanguageChoice({ id: 'q1', data: 'lang:en', from: user() } as never)

      expect(lastMessage(api).text).toContain('Language switched to English')
      expect(lastMessage(api).reply_markup.keyboard.flat()[0].text).toBe('📖 Guide')
    })

    it('answers an unrecognised payload and changes nothing', async () => {
      await service.handleLanguageChoice({ id: 'q1', data: 'lang:de', from: user() } as never)

      expect(api.answerCallbackQuery).toHaveBeenCalledTimes(1)
      expect(users.setLocale).not.toHaveBeenCalled()
      expect(api.sendMessage).not.toHaveBeenCalled()
    })
  })

  it('sends the guide with formatting Telegram will render', async () => {
    await service.handleButton(SupportButton.GUIDE, user(), SupportLocale.UK)

    expect(lastMessage(api)).toMatchObject({ parse_mode: 'HTML' })
    expect(lastMessage(api).text).toContain('Як працює Open Funds')
  })

  it('prompts for a question on the support key rather than opening a topic', async () => {
    await service.handleButton(SupportButton.SUPPORT, user(), SupportLocale.EN)

    expect(lastMessage(api).text).toContain('Describe your question')
  })
})
