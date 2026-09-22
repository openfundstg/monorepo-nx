import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { KOPECKS_PER_UAH } from '@transacto/contracts'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaFiatDepositStuckEvent } from 'src/shared/interfaces'
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
 *
 * **One-way only.** An alert that is *answered* is a conversation rather than a
 * notice, and it lives with its answer — see `SupportTailService`, which holds
 * both halves of a tail's exchange for the reason `SupportCardSaleService`
 * holds both halves of a card order's.
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
}
