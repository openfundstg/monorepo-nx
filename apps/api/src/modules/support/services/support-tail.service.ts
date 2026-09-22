import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ERROR, formatCardNumber, KOPECKS_PER_UAH, SaleMethod } from '@transacto/contracts'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TelegramMessage, TmaSaleTailReachedEvent } from 'src/shared/interfaces'
import { describeError, describeTelegramFailure, errorCodeOf } from 'src/shared/utils'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { StoredSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleTailService } from 'src/modules/telegram-mini-app'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import { SupportAdminText } from 'src/modules/support/constants/support-bot-text.constants'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'

/** Hryvnia, as an operator reads them: `700` rather than `70000`. */
const uah = (kopecks: number): string => (kopecks / KOPECKS_PER_UAH).toFixed(2)

/**
 * The bot's half of a sale's last stretch: the ask, and the answer to it.
 *
 * A tail is the gap under Transacto's order floor — nothing can be routed for
 * it, so it arrives as one transfer an operator makes by hand or it does not
 * arrive at all. Both directions of that exchange live here, for the reason
 * `SupportCardSaleService` holds both directions of a card order's: a message
 * that is answered is one conversation, and splitting it across two files puts
 * the question in one place and what it means in another.
 *
 * **The answer is a reply saying `+`, and it is load-bearing rather than
 * polite.** Until an operator writes it, nothing is on its way: the seller's
 * screen says only that somebody was asked, they may still stop the sale, and
 * stopping costs nobody anything. Once it is written, the sale stops being
 * theirs to end — because hryvnia is about to reach a card no scraper watches,
 * and a sale that closed in between would take a real transfer into a finished
 * order. That is the whole of why the claim exists and why this file answers
 * every `+` it takes: silence has to mean "not taken", so it can never be
 * mistaken for "taken".
 *
 * **And `-` is the only way back out of it.** The hold has no timer, because a
 * seller saying the transfer never came is making a claim about what an
 * operator did and a clock would settle that in their favour by default. So the
 * seller goes to support and a person decides; `-` under the same alert is that
 * decision, and it gives the gap back to them as USDT.
 *
 * Nothing here throws. An exception escaping a webhook handler is Telegram
 * redelivering the same update forever.
 */
@Injectable()
export class SupportTailService {
  private readonly logger = new Logger(SupportTailService.name)

  constructor(
    private readonly telegramApi: TelegramBotApiService,
    private readonly config: SupportConfigService,
    private readonly saleDb: TmaSaleDbService,
    private readonly tails: SaleTailService
  ) {}

  /**
   * A sale with less left to collect than any payer can be routed for, and a
   * seller waiting for somebody to transfer it.
   *
   * Fires once per sale — the gate is on the sale, not here — and only once
   * nothing is left to ask the seller for, so the figure below is not one a
   * statement is about to correct.
   *
   * **This message carries a card number, and it is the only one that does.**
   * Every other alert in this module deliberately holds them back. The
   * exception is a decision rather than an oversight: an operator woken at two
   * in the morning cannot make a transfer from four digits, and the cost of
   * putting it here is that it sits in this group's history on every operator's
   * phone. The root `CLAUDE.md` records that trade and why it was taken.
   *
   * It is the *seller's own* card, which is what makes it bearable — this
   * product never puts a third party's credential anywhere near a chat.
   *
   * **Its own id is stored, and that is what makes it answerable.** A reply
   * identifies what it answers by message id and nothing else, so an alert
   * whose id did not land is an alert nobody can take on — which is said in the
   * log and, to an operator, by the absence of an acknowledgement.
   */
  @OnEvent(TMA_DOMAIN_EVENT.SALE_TAIL_REACHED)
  async onSaleTailReached(event: TmaSaleTailReachedEvent): Promise<void> {
    const { groupId } = this.config
    if (groupId === null) return

    const text =
      `🟡 Продаж ${event.publicId} добирає останнє\n\n` +
      `Треба переказати: ${uah(event.tailKopecks)} ₴\n` +
      `${this.destination(event)}\n` +
      `Продаж: ${uah(event.fiatAmount)} ₴ · зараховано ${uah(event.receivedAmount)} ₴\n` +
      `Юзер: ${event.telegramId}\n\n` +
      `Менше цієї суми Transacto нікого не зароутить, тому автоматично вона вже не ` +
      `надійде. Роутинг на цей продаж вимкнено, щоб ніхто не перевищив ціль.\n\n` +
      `➡️ Перш ніж переказувати — відповідьте на це повідомлення ` +
      `«${SupportConfig.TAIL_CLAIM_REPLY}». Поки ніхто не відповів, продавець може ` +
      `завершити продаж, і переказ піде в закритий ордер. Переказуйте лише після ` +
      `«${SupportAdminText.TAIL_TAKEN_MARK}».\n` +
      `Після цього продаж заблоковано для продавця, доки не надійде переказ, — тож якщо ` +
      `переказу не буде, відповідьте «${SupportConfig.TAIL_RELEASE_REPLY}», і залишок ` +
      `повернеться йому в USDT.`

    try {
      const sent = await this.telegramApi.sendMessage({ chat_id: groupId, text })

      // Written after the send because the id does not exist before it. A
      // failure here leaves an alert nobody can answer, which is why it is an
      // error line and not a shrug.
      const stored = await this.saleDb.rememberTailAlert(event.saleId, sent.message_id)
      if (!stored)
        this.logger.error(
          `Sale ${event.publicId}: its tail alert went out but could not be recorded; ` +
            `a reply to it will not be recognised`
        )
    } catch (error: unknown) {
      // The sale, never the destination.
      this.logger.error(
        `Could not announce the tail of sale ${event.publicId} to the support group: ` +
          describeError(error)
      )
    }
  }

  /**
   * An operator answers one of those alerts.
   *
   * Reached for every reply in the group's General thread, most of which are
   * about nothing — so the two cheap checks come first, and a reply that is
   * neither answer, or is under something that is not an alert of ours, leaves
   * exactly as quietly as it did before this existed.
   *
   * The sale is resolved from the message being replied to rather than from
   * anything the operator typed, so there is no id to get wrong and nothing to
   * address the wrong sale with.
   */
  async handleReply(message: TelegramMessage, replyToId: number): Promise<void> {
    const answer = message.text?.trim()
    const taking = answer === SupportConfig.TAIL_CLAIM_REPLY
    if (!taking && answer !== SupportConfig.TAIL_RELEASE_REPLY) return

    const sale = await this.saleDb.findByTailAlert(replyToId)
    if (!sale) return

    // **Logged on the way in, before anything can refuse it.** The whole
    // visible effect of an answer is a sentence back in the chat, so "I wrote
    // it and nothing happened" has two completely different causes — it never
    // reached this deployment, or it reached it and was refused. One line here
    // is what tells those apart without a reproduction.
    this.logger.log(
      `Tail of sale ${sale.publicId} answered '${answer}' by ${message.from?.id ?? 'unknown'}`
    )

    try {
      await this.answer(message, taking ? await this.take(sale) : await this.give(sale))
    } catch (error: unknown) {
      await this.answer(message, this.textFor(error))

      this.logger.warn(
        `Tail of sale ${sale.publicId} could not be answered: ${describeError(error)}`
      )
    }
  }

  /** `+`: this operator is making the transfer. */
  private async take(sale: StoredSale): Promise<string> {
    return (await this.tails.claim(sale._id.toString()))
      ? SupportAdminText.tailClaimed(sale.publicId, SupportConfig.TAIL_RELEASE_REPLY)
      : SupportAdminText.TAIL_ALREADY_CLAIMED
  }

  /** `-`: nobody is, and the seller gets the gap back as USDT. */
  private async give(sale: StoredSale): Promise<string> {
    return (await this.tails.waive(sale._id.toString()))
      ? SupportAdminText.tailWaived(sale.publicId)
      : SupportAdminText.TAIL_ALREADY_WAIVED
  }

  /**
   * Which sentence a failure deserves.
   *
   * Two outcomes an operator acts on differently, and only the code tells them
   * apart. "No longer waiting" means there is nothing to do either way — the
   * sale has closed or filled, so a transfer would land in a finished order and
   * there is no gap left to give back. Anything else means try again, and
   * saying "do not transfer" where the truth is "ask me again" is how a seller
   * is left waiting for a transfer nobody makes.
   */
  private textFor(error: unknown): string {
    const code = errorCodeOf(error)

    return code === ERROR.SALE.TAIL_NOT_WAITING.code || code === ERROR.SALE.NOT_FOUND.code
      ? SupportAdminText.TAIL_NOT_WAITING
      : SupportAdminText.TAIL_CLAIM_FAILED
  }

  /**
   * Says what happened, under the `+` that said it.
   *
   * Quoted rather than posted loose because several alerts can be open at once
   * in the same thread, and an acknowledgement nobody can attribute is one
   * operator reading another's confirmation as their own.
   */
  private async answer(message: TelegramMessage, text: string): Promise<void> {
    const { groupId } = this.config
    if (groupId === null) return

    try {
      await this.telegramApi.sendMessage({
        chat_id: groupId,
        text,
        // The quote is a nicety; the message is not — see `SupportRelayService`.
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true }
      })
    } catch (error: unknown) {
      this.logger.error(
        `Could not answer a tail claim in the support group: ` +
          describeTelegramFailure('sendMessage', error)
      )
    }
  }

  /**
   * The one line an operator acts on.
   *
   * Grouped into fours for a card, because a number read off a phone and typed
   * into a banking app is read in fours — `formatCardNumber` is the same
   * grouping the create form shows. A jar sale's link goes as it is.
   *
   * A destination that could not be read says so and names what to do instead,
   * rather than leaving a blank line somebody has to interpret.
   */
  private destination(event: TmaSaleTailReachedEvent): string {
    if (event.payoutTarget === null)
      return 'Куди: не вдалося прочитати — подивіться реквізити продажу в панелі'

    return event.saleMethod === SaleMethod.CARD
      ? `Картка: ${formatCardNumber(event.payoutTarget)}`
      : `Банка: ${event.payoutTarget}`
  }
}
