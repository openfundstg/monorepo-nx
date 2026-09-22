import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { formatCardNumber, KOPECKS_PER_UAH, SaleMethod } from '@transacto/contracts'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaFiatDepositStuckEvent, TmaSaleTailReachedEvent } from 'src/shared/interfaces'
import { describeError } from 'src/shared/utils'

/** Hryvnia, as an operator reads them: `700` rather than `70000`. */
const uah = (kopecks: number): string => (kopecks / KOPECKS_PER_UAH).toFixed(2)

/**
 * Carries the things nobody else will notice into the room the operators are in.
 *
 * The support group already exists, everyone who could act is already in it,
 * and it needs no new bot, no new chat id and no new secret. A dedicated
 * channel would be tidier and would be one more thing to remember to watch.
 *
 * **It listens rather than being called.** The reconciler that finds these must
 * not know that a Telegram group exists — the dependency would point from the
 * Mini App module at a consumer of it, which is the direction the boundaries
 * forbid. It emits a neutral fact; this decides that the fact is worth a
 * message.
 *
 * Nothing here ever throws. An alert that fails is a message nobody sees; an
 * alert that throws would take the reconciler's pass down with it, and the pass
 * is what settles other people's money.
 */
@Injectable()
export class SupportAlertsListener {
  private readonly logger = new Logger(SupportAlertsListener.name)

  constructor(
    private readonly telegramApi: TelegramBotApiService,
    private readonly config: SupportConfigService
  ) {}

  /**
   * A hryvnia top-up holding a payout that will never free itself.
   *
   * Repeats every five minutes for as long as it is true — the throttle lives
   * with the reconciler, which knows when it last said this. The message is
   * written to be actionable at two in the morning: what is stuck, for how
   * long, how much is in it, and the two things an operator can do about it.
   *
   * No card number, no receipt link, no payer name. Those stay on the record
   * and in the panel, where they are already behind a login.
   */
  @OnEvent(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STUCK)
  async onFiatDepositStuck(event: TmaFiatDepositStuckEvent): Promise<void> {
    const { groupId } = this.config
    if (groupId === null) return

    const text =
      `🟠 Поповнення тримає виплату вже ${event.heldForMinutes} хв\n\n` +
      `Виплата #${event.payoutId} · ${uah(event.amountUah)} ₴\n` +
      `Зараховано в неї: ${uah(event.coveredUah)} ₴\n` +
      `Юзер: ${event.telegramId}\n` +
      `Поповнення: ${event.depositId}\n\n` +
      `У виплату вже переказали гроші, тому автоматично вона не звільниться — ` +
      `віддати її назад означало б віддати чужий переказ іншому трейдеру.\n` +
      `Потрібне рішення: завершити поповнення або звільнити виплату вручну.`

    try {
      await this.telegramApi.sendMessage({ chat_id: groupId, text })
    } catch (error: unknown) {
      this.logger.error(
        `Could not announce stuck top-up ${event.depositId} to the support group: ` +
          describeError(error)
      )
    }
  }

  /**
   * A sale with less left to collect than any payer can be routed for, and a
   * seller waiting for somebody to transfer it.
   *
   * Fires once per sale — the gate is on the sale, not here — and only once
   * nothing is left to ask the seller for, so the figure below is not one a
   * statement is about to correct.
   *
   * **This message carries a card number, and it is the only one that does.**
   * Every other alert in this file deliberately holds them back — "no card
   * number, no receipt link, no payer name" is written two methods up. The
   * exception is a decision rather than an oversight: an operator woken at two
   * in the morning cannot make a transfer from four digits, and the cost of
   * putting it here is that it sits in this group's history on every operator's
   * phone. The root `CLAUDE.md` records that trade and why it was taken.
   *
   * It is the *seller's own* card, which is what makes it bearable — this
   * product never puts a third party's credential anywhere near a chat.
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
      `надійде. Роутинг на цей продаж вимкнено, щоб ніхто не перевищив ціль.`

    try {
      await this.telegramApi.sendMessage({ chat_id: groupId, text })
    } catch (error: unknown) {
      // The sale, never the destination.
      this.logger.error(
        `Could not announce the tail of sale ${event.publicId} to the support group: ` +
          describeError(error)
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
