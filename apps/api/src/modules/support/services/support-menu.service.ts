import { Injectable, Logger } from '@nestjs/common'
import { SupportLocale } from 'src/shared/constants'
import { describeError } from 'src/shared/utils'
import { TelegramParseMode } from 'src/shared/interfaces'
import type { TelegramCallbackQuery, TelegramReplyMarkup, TelegramUser } from 'src/shared/interfaces'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { SupportButton } from 'src/modules/support/enums'
import {
  SupportUserText,
  type SupportRates,
  supportBalanceCard,
  supportGuideText,
  supportUserText
} from 'src/modules/support/constants/support-bot-text.constants'
import { SupportUserService } from 'src/modules/support/services/support-user.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import {
  buildLanguageKeyboard,
  buildMainKeyboard,
  localeFromCallbackData
} from 'src/modules/support/utils'

/**
 * Everything the bot answers on its own — the keyboard under the input field
 * and the four keys that do not involve an operator.
 *
 * Kept apart from `SupportRelayService` because the two have opposite jobs:
 * that one moves somebody else's words and never reads them, this one produces
 * words of its own and never forwards anything.
 */
@Injectable()
export class SupportMenuService {
  private readonly logger = new Logger(SupportMenuService.name)

  constructor(
    private readonly telegramApi: TelegramBotApiService,
    private readonly userService: SupportUserService,
    private readonly tmaUserDbService: TmaUserDbService,
    private readonly exchangeRateService: ExchangeRateService
  ) {}

  /** Answers `/start`: a hello, and the keyboard everything else hangs off. */
  async sendGreeting(user: TelegramUser, locale: SupportLocale): Promise<void> {
    await this.sendText(user, SupportUserText.GREETING, locale)
  }

  /** Acts on a key press. Every branch redraws the keyboard, so a lost one comes back. */
  async handleButton(
    button: SupportButton,
    user: TelegramUser,
    locale: SupportLocale
  ): Promise<void> {
    if (button === SupportButton.GUIDE) return this.sendGuide(user, locale)
    if (button === SupportButton.BALANCE) return this.sendBalance(user, locale)
    if (button === SupportButton.LANGUAGE) return this.sendLanguageChoices(user, locale)

    return this.sendText(user, SupportUserText.SUPPORT_PROMPT, locale)
  }

  /**
   * Records a language chosen from the inline keys.
   *
   * The query is answered **first, whatever happens next**: until it is, the
   * client spins on the button, and a user who thinks a control is broken
   * presses it again. The confirmation is then rendered in the *new* language,
   * which is the only way the change is legible to somebody who cannot read the
   * old one.
   */
  async handleLanguageChoice(query: TelegramCallbackQuery): Promise<void> {
    const chosen = localeFromCallbackData(query.data)

    await this.telegramApi.answerCallbackQuery({ callback_query_id: query.id })

    if (!chosen) {
      this.logger.warn(`Callback ${query.id} carried unrecognised data: ${query.data ?? 'none'}`)

      return
    }

    await this.userService.setLocale(query.from.id, chosen)
    await this.sendText(query.from, SupportUserText.LANGUAGE_SET, chosen)
  }

  /**
   * One bot-authored line, with the keyboard attached.
   *
   * The keyboard rides on every message rather than being sent once at `/start`:
   * Telegram keeps a persistent keyboard until something replaces it, but a
   * user who cleared theirs, or who arrived before this feature existed, would
   * otherwise have no way back to it.
   */
  /**
   * HTML, like the guide and the balance card — so every dictionary string is
   * read the same way rather than some being markup and some being literal.
   *
   * It became necessary when the greeting gained a link to the channel, and
   * making it the rule for all of them is what stops the next link being added
   * to a message that renders its own tag as text. The cost is that a dictionary
   * string may not contain a bare `<`, `>` or `&`; the spec beside the
   * dictionaries holds that.
   */
  async sendText(
    user: TelegramUser,
    key: SupportUserText,
    locale: SupportLocale
  ): Promise<void> {
    await this.telegramApi.sendMessage({
      chat_id: user.id,
      text: supportUserText(key, locale),
      parse_mode: TelegramParseMode.HTML,
      reply_markup: this.mainKeyboard(locale)
    })
  }

  private async sendGuide(user: TelegramUser, locale: SupportLocale): Promise<void> {
    await this.telegramApi.sendMessage({
      chat_id: user.id,
      text: supportGuideText(locale),
      parse_mode: TelegramParseMode.HTML,
      reply_markup: this.mainKeyboard(locale)
    })
  }

  /**
   * The user's money, or an explanation of why there is none to show.
   *
   * Read from `tma_users`, which not every bot user has: anyone can message a
   * bot, and an account only exists once the Mini App has been opened. That is
   * a normal state, not an error — hence a sentence rather than a zero, which
   * would be a lie about money.
   *
   * Three figures, matching the dashboard exactly: `balance` is spendable and
   * already has `frozenBalance` taken out of it, and `referralBalance` is a
   * separate pot that cannot fund an order. All in USDT cents.
   */
  private async sendBalance(user: TelegramUser, locale: SupportLocale): Promise<void> {
    // Independent reads: the rate does not depend on the account, and one round
    // trip to Mongo plus one to the panel run at the cost of the slower.
    const [account, rates] = await Promise.all([
      this.tmaUserDbService.findByTelegramId(user.id),
      this.currentRates()
    ])

    if (!account) return this.sendText(user, SupportUserText.BALANCE_NO_ACCOUNT, locale)

    await this.telegramApi.sendMessage({
      chat_id: user.id,
      text: supportBalanceCard(locale, {
        available: account.balance,
        frozen: account.frozenBalance,
        referral: account.referralBalance,
        turnover: account.totalTurnover,
        rates
      }),
      parse_mode: TelegramParseMode.HTML,
      reply_markup: this.mainKeyboard(locale)
    })
  }

  /**
   * Both live prices, or `null`.
   *
   * `getSpread` rather than the two getters: they are printed side by side with
   * their difference underneath, and two separate reads can straddle the
   * one-minute cache and come back from two different moments — a spread
   * computed across two markets, presented as one.
   *
   * `ExchangeRateService` throws rather than quote a price it is unsure of, and
   * that is right where money is being priced — but this card prices nothing.
   * Losing the whole balance to a panel outage would be the wrong trade, so the
   * failure is swallowed here and nowhere else.
   */
  private async currentRates(): Promise<SupportRates | null> {
    try {
      return await this.exchangeRateService.getSpread()
    } catch (error) {
      this.logger.warn(`Balance card is going out without rates: ${describeError(error)}`)

      return null
    }
  }

  /** The language menu — inline, so choosing one does not send a message to relay. */
  private async sendLanguageChoices(user: TelegramUser, locale: SupportLocale): Promise<void> {
    await this.telegramApi.sendMessage({
      chat_id: user.id,
      text: supportUserText(SupportUserText.LANGUAGE_PROMPT, locale),
      reply_markup: buildLanguageKeyboard()
    })
  }

  private mainKeyboard(locale: SupportLocale): TelegramReplyMarkup {
    return buildMainKeyboard(locale)
  }
}
