import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ERROR } from '@transacto/contracts'
import environments from 'src/environments'
import {
  SupportUserText,
  supportCardOrderAwaitingText,
  supportCardOrderDisputedText,
  supportUserText
} from 'src/modules/support/constants/support-bot-text.constants'
import { SupportUserService } from 'src/modules/support/services/support-user.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import {
  buildCardOrderKeyboard,
  cardSaleConfirmOrderId,
  cardSaleDenyOrderId
} from 'src/modules/support/utils'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SupportLocale } from 'src/shared/constants'
import { TMA_DOMAIN_EVENT, TelegramParseMode } from 'src/shared/interfaces'
import type { TelegramCallbackQuery, TmaSaleCardOrderEvent } from 'src/shared/interfaces'
import {
  describeError,
  describeTelegramFailure,
  errorCodeOf,
  miniAppLink
} from 'src/shared/utils'

/**
 * The bot's half of a card sale.
 *
 * A card sale settles on its seller saying the money reached their card, and a
 * Mini App they may not have open is the wrong place to ask. So the question
 * goes to the chat they already get messages in, with two keys under it.
 *
 * **The keys settle money, and that is safe for one reason worth stating.** A
 * confirmation is testimony against the teller's own interest: confirming
 * hryvnia that never came costs them their own stake. Nobody else can press it
 * for them either — the payload carries only Transacto's order id, the sale is
 * looked up from it, and `SaleCardOrderService` proves the presser owns it.
 *
 * Nothing here throws. A message nobody sees is a bad afternoon; an exception
 * escaping a webhook handler is Telegram redelivering the same update forever.
 */
@Injectable()
export class SupportCardSaleService {
  private readonly logger = new Logger(SupportCardSaleService.name)

  constructor(
    private readonly telegramApi: TelegramBotApiService,
    private readonly users: SupportUserService,
    private readonly cardOrders: SaleCardOrderService,
    private readonly saleDb: TmaSaleDbService
  ) {}

  /**
   * A payer was routed to this seller's card.
   *
   * **No deny key.** This message is written the moment the payment is routed,
   * when it is not late by any measure — denying here would stop routing to the
   * terminal over a transfer still in flight, costing the seller the rest of
   * their own sale. There is nothing to lose by leaving it out: the sweep
   * disputes the order by itself the moment its deadline passes, and the
   * message it sends then is where the question belongs.
   *
   * A keyboard, unlike a screen, cannot change its mind — this message will
   * still be sitting in the chat an hour later — which is why the rule is also
   * enforced in `SaleCardOrderService.deny`.
   */
  @OnEvent(TMA_DOMAIN_EVENT.SALE_CARD_ORDER_AWAITING)
  async onOrderAwaiting(event: TmaSaleCardOrderEvent): Promise<void> {
    await this.tell(event, supportCardOrderAwaitingText, { canDeny: false })
  }

  /** …and nobody said whether it arrived, so the sale is paused. */
  @OnEvent(TMA_DOMAIN_EVENT.SALE_CARD_ORDER_DISPUTED)
  async onOrderDisputed(event: TmaSaleCardOrderEvent): Promise<void> {
    // No deny key: the order is already disputed, so a key offering to deny it
    // could only ever answer "that is where it already is". What is left to say
    // is "it did arrive after all", which the confirm key covers.
    await this.tell(event, supportCardOrderDisputedText, { canDeny: false })
  }

  /**
   * The seller pressed one of the two keys.
   *
   * The sale is resolved from the order id rather than carried in the payload,
   * so a `callback_data` a client could edit cannot name somebody else's sale —
   * and ownership is proven again inside `SaleCardOrderService` regardless.
   */
  async handleAnswer(query: TelegramCallbackQuery): Promise<void> {
    // Acknowledged first and **never allowed to decide anything**. The keys sit
    // on a message that stays in the chat forever, so one is pressed on last
    // week's notification — and Telegram answers `query is too old` with a 400,
    // which this module's transport rethrows. Letting that escape would abort
    // the whole update, and a seller who pressed "money arrived" would not have.
    try {
      await this.telegramApi.answerCallbackQuery({ callback_query_id: query.id })
    } catch (error: unknown) {
      this.logger.debug(
        `Could not acknowledge card sale query ${query.id}: ` +
          describeTelegramFailure('answerCallbackQuery', error)
      )
    }

    const confirming = cardSaleConfirmOrderId(query.data)
    const orderId = confirming ?? cardSaleDenyOrderId(query.data)
    if (orderId === null) return

    const telegramId = query.from.id
    const locale = await this.localeOf(telegramId)

    try {
      const answer = await this.answer(telegramId, orderId, confirming !== null)

      await this.reply(telegramId, answer)
    } catch (error: unknown) {
      await this.reply(telegramId, this.textFor(error), locale)

      // Logged whatever it was. A refusal is ordinary and an outage is not, and
      // the log line is the only place that distinction survives — the seller
      // is told something reassuring either way.
      this.logger.warn(
        `Card sale key from ${telegramId} on order ${orderId} did not go through: ` +
          describeError(error)
      )
    }
  }

  /** Runs the answer, and says which sentence the seller gets. */
  private async answer(
    telegramId: number,
    orderId: number,
    confirming: boolean
  ): Promise<SupportUserText> {
    const sale = await this.saleDb.findByCardOrderId(orderId)
    if (!sale || sale.telegramId !== telegramId) return SupportUserText.CARD_ORDER_NOT_FOUND

    const saleId = sale._id.toString()

    if (confirming) {
      await this.cardOrders.confirm(telegramId, saleId, orderId)

      return SupportUserText.CARD_ORDER_CONFIRMED
    }

    await this.cardOrders.deny(telegramId, saleId, orderId)

    return SupportUserText.CARD_ORDER_DENIED
  }

  /**
   * Which sentence a failure deserves.
   *
   * Three outcomes the seller can act on differently, and the codes are what
   * tell them apart — the HTTP statuses do not. "Already answered" is routine
   * and reassuring; "cannot be confirmed any more" means go to support; anything
   * else means try again, and saying "no" where the truth is "not just now"
   * would cost somebody their own money.
   */
  private textFor(error: unknown): SupportUserText {
    const code = errorCodeOf(error)

    if (code === ERROR.SALE_CARD.ORDER_NOT_AWAITING.code)
      return SupportUserText.CARD_ORDER_ALREADY_ANSWERED

    if (code === ERROR.SALE_CARD.ORDER_NOT_OVERDUE.code)
      return SupportUserText.CARD_ORDER_NOT_OVERDUE

    if (code === ERROR.SALE_CARD.ORDER_NOT_EXECUTABLE.code)
      return SupportUserText.CARD_ORDER_NOT_EXECUTABLE

    if (code === ERROR.SALE.NOT_FOUND.code || code === ERROR.SALE_CARD.ORDER_NOT_FOUND.code)
      return SupportUserText.CARD_ORDER_NOT_FOUND

    return SupportUserText.CARD_ORDER_FAILED
  }

  /** Writes one question to the seller, keys and all. */
  private async tell(
    event: TmaSaleCardOrderEvent,
    render: (locale: SupportLocale, view: { amount: number; publicId: string }) => string,
    options: { readonly canDeny: boolean }
  ): Promise<void> {
    try {
      const locale = await this.localeOf(event.telegramId)

      await this.telegramApi.sendMessage({
        chat_id: event.telegramId,
        text: render(locale, { amount: event.amount, publicId: event.publicId }),
        parse_mode: TelegramParseMode.HTML,
        reply_markup: buildCardOrderKeyboard(locale, {
          orderId: event.orderId,
          canDeny: options.canDeny,
          appUrl: this.miniAppUrl()
        })
      })
    } catch (error: unknown) {
      // Swallowed on purpose. The order stands either way, the Mini App shows
      // it, and the sweep will dispute it on time whether or not this landed —
      // the bot is a second surface, never the only one.
      this.logger.error(
        `Could not tell ${event.telegramId} about card order ${event.orderId}: ` +
          describeTelegramFailure('sendMessage', error)
      )
    }
  }

  private async reply(
    telegramId: number,
    key: SupportUserText,
    known?: SupportLocale
  ): Promise<void> {
    try {
      const locale = known ?? (await this.localeOf(telegramId))

      await this.telegramApi.sendMessage({
        chat_id: telegramId,
        text: supportUserText(key, locale)
      })
    } catch (error: unknown) {
      this.logger.error(
        `Could not answer ${telegramId} about a card order: ` +
          describeTelegramFailure('sendMessage', error)
      )
    }
  }

  private async localeOf(telegramId: number): Promise<SupportLocale> {
    return this.users.localeFor(telegramId)
  }

  /** `null` on a deployment with no bot username — a key is dropped, not the message. */
  private miniAppUrl(): string | null {
    const username = environments.TELEGRAM_BOT_USERNAME?.trim()

    return username ? miniAppLink(username) : null
  }
}
