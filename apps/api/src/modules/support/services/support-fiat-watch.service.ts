import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { FiatDepositWatchMode, MiniAppStartParam } from '@transacto/contracts'
import environments from 'src/environments'
import { TmaFiatDepositWatchDbService } from 'src/modules/repositories/tma-fiat-deposit-watch-db/services'
import {
  SupportUserText,
  supportFiatAmountsText,
  supportUserText
} from 'src/modules/support/constants/support-bot-text.constants'
import { SupportUserService } from 'src/modules/support/services/support-user.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import { buildFiatWatchKeyboard } from 'src/modules/support/utils'
import { TMA_DOMAIN_EVENT, TelegramParseMode } from 'src/shared/interfaces'
import type { TelegramCallbackQuery, TmaFiatDepositAmountsAvailableEvent } from 'src/shared/interfaces'
import {
  TelegramFailure,
  describeError,
  describeTelegramFailure,
  miniAppLink,
  telegramFailureOf,
  telegramRetryAfter
} from 'src/shared/utils'

/**
 * The failures that mean this person can never be written to again.
 *
 * Three states, one consequence: they pressed Stop, their account is gone, or
 * they have never started the bot at all — the last of which a Mini App user
 * reaches simply by opening the app from a link. Their request is removed
 * rather than retried on every book movement for as long as the app runs.
 */
const UNREACHABLE_FAILURES: readonly TelegramFailure[] = [
  TelegramFailure.BLOCKED_BY_USER,
  TelegramFailure.USER_DEACTIVATED,
  TelegramFailure.CANNOT_INITIATE
]

/**
 * Longest this listener will hold a message back for a rate limit.
 *
 * A `429` is the one failure where waiting is the whole remedy, and the amount
 * it was about is already in the snapshot — it will never be diffed as new
 * again, so giving up loses that notification for good rather than deferring
 * it. The cap is what keeps that from becoming an unbounded sleep inside an
 * event handler: `retry_after` is usually a second or two, and anything past
 * this is a bot in enough trouble that the message is stale anyway.
 */
const MAX_RATE_LIMIT_WAIT_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The half of "tell me when a sum appears" that involves Telegram.
 *
 * The Mini App decides *who* to call and *about what*; this decides how it
 * reads, in which language, and what happens afterwards — and the split is the
 * module boundary: the Mini App must not know a bot exists, and the bot has no
 * business matching amounts to ranges.
 *
 * **The aftermath belongs here and nowhere else.** A one-off request is deleted
 * and a standing one stamped only once Telegram has accepted the message,
 * because the only failure this feature must never produce is a request retired
 * for a call that was never made. The emitter cannot know that; this can.
 *
 * Nothing here throws. A message nobody sees is a bad afternoon; an exception
 * escaping into the book refresh is every user's offer going stale.
 */
@Injectable()
export class SupportFiatWatchService {
  private readonly logger = new Logger(SupportFiatWatchService.name)

  constructor(
    private readonly telegramApi: TelegramBotApiService,
    private readonly users: SupportUserService,
    private readonly watchDb: TmaFiatDepositWatchDbService
  ) {}

  /**
   * Calls a user back about an amount they asked for.
   *
   * The unsubscribe key is drawn only for a standing request: a one-off is
   * already spent by the time the message lands, so a key offering to cancel it
   * could only ever answer "there was nothing to cancel".
   */
  @OnEvent(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_AMOUNTS_AVAILABLE)
  async onAmountsAvailable(event: TmaFiatDepositAmountsAvailableEvent): Promise<void> {
    const once = event.mode === FiatDepositWatchMode.ONCE

    if (!(await this.send(event))) return

    // Settled only after a delivery, and outside the send's own error handling.
    // Sharing it meant a database failure *after* a delivered message was
    // reported as a failure to deliver — a false log line, and worse, a `ONCE`
    // request left alive to message the same user again on the next arrival.
    //
    // Retried once, because that duplicate is the only one this design has no
    // other defence against: the message is gone, so there is no undoing it,
    // and the request will fire again the next time the book moves.
    try {
      await this.settleWithRetry(event.watchId, once)
    } catch (error: unknown) {
      this.logger.error(
        `Told ${event.telegramId} about ${event.amountsUah.length} new amount(s) but could not ` +
          `settle watch ${event.watchId} — ${
            once ? 'it may notify them a second time' : 'its stamp is stale'
          }: ${describeError(error)}`
      )
    }
  }

  private async settleWithRetry(watchId: string, once: boolean): Promise<void> {
    try {
      return await this.settle(watchId, once)
    } catch {
      return this.settle(watchId, once)
    }
  }

  /**
   * Writes the message, and answers whether it landed.
   *
   * `false` means the caller must retire nothing, because nothing was
   * delivered. The rate-limit retry lives **inside** this method rather than
   * beside it, so a message that lands on the second attempt still reaches the
   * settling step — an earlier cut returned `false` on the first refusal and
   * left the request unsettled even when the retry succeeded.
   */
  private async send(
    event: TmaFiatDepositAmountsAvailableEvent,
    retried = false
  ): Promise<boolean> {
    const once = event.mode === FiatDepositWatchMode.ONCE

    try {
      const locale = await this.users.localeFor(event.telegramId)

      await this.telegramApi.sendMessage({
        chat_id: event.telegramId,
        text: supportFiatAmountsText(locale, {
          amountsUah: event.amountsUah,
          minAmountUah: event.minAmountUah,
          maxAmountUah: event.maxAmountUah,
          once
        }),
        parse_mode: TelegramParseMode.HTML,
        reply_markup: buildFiatWatchKeyboard(locale, {
          canUnsubscribe: !once,
          appUrl: this.miniAppUrl()
        })
      })

      return true
    } catch (error: unknown) {
      const failure = telegramFailureOf(error)

      // Waiting *is* the remedy for a rate limit, and nothing else will come
      // back for this amount: the snapshot already holds it, so it is never
      // diffed as new again and giving up loses the notification for good
      // rather than deferring it. Once only — a second refusal after the wait
      // Telegram itself asked for is a queue, and this listener is not one.
      if (failure === TelegramFailure.RATE_LIMITED && !retried) {
        await sleep(Math.min((telegramRetryAfter(error) ?? 1) * 1000, MAX_RATE_LIMIT_WAIT_MS))

        return this.send(event, true)
      }

      await this.dropIfUnreachable(event, failure, error)

      return false
    }
  }

  /**
   * The unsubscribe key under a notification.
   *
   * The request cancelled is always the presser's own — the payload carries no
   * id, precisely so that a payload a client can edit cannot cancel somebody
   * else's. The query is answered before anything else for the reason the
   * language keys already document: until it is, the client spins on the button.
   */
  async handleUnsubscribe(query: TelegramCallbackQuery): Promise<void> {
    // Acknowledged first and **never allowed to decide anything**. The key sits
    // on a message that stays in the chat forever, so it is pressed on last
    // week's notification — and Telegram answers `query is too old` with a 400,
    // which this service's transport rethrows. Letting that escape aborted the
    // whole update: the removal below never ran, the webhook redelivered and
    // failed identically, and somebody who pressed unsubscribe stayed
    // subscribed.
    try {
      await this.telegramApi.answerCallbackQuery({ callback_query_id: query.id })
    } catch (error: unknown) {
      this.logger.debug(
        `Could not acknowledge unsubscribe query ${query.id}: ` +
          describeTelegramFailure('answerCallbackQuery', error)
      )
    }

    // Everything below is inside the guard, not only the send. The
    // acknowledgement above is already spent by the time we get here, so an
    // exception escaping into the webhook buys nothing: Telegram redelivers,
    // the ack fails as stale, and somebody who pressed unsubscribe stays
    // subscribed while the log fills with the same stack trace.
    try {
      const removed = await this.watchDb.removeByTelegramId(query.from.id)
      const locale = await this.users.localeFor(query.from.id)

      await this.telegramApi.sendMessage({
        chat_id: query.from.id,
        text: supportUserText(
          removed ? SupportUserText.FIAT_WATCH_CANCELLED : SupportUserText.FIAT_WATCH_ALREADY_OFF,
          locale
        )
      })
    } catch (error: unknown) {
      this.logger.error(
        `Unsubscribe from ${query.from.id} could not be completed: ` +
          describeTelegramFailure('sendMessage', error)
      )
    }
  }

  /**
   * Retires the request the message answered.
   *
   * A `ONCE` request is gone; a standing one is stamped, which nothing throttles
   * on — it is what the operator panel sorts by to find the ranges nobody has
   * ever been able to fill.
   */
  private async settle(watchId: string, once: boolean): Promise<void> {
    if (once) return this.watchDb.removeById(watchId)

    return this.watchDb.markNotified(watchId, new Date())
  }

  /**
   * What to do about a message that did not go.
   *
   * A user who has blocked the bot, deleted their account, or never started the
   * bot at all can never be told anything, so their request is removed rather
   * than retried on every book movement for as long as the app runs. Anything
   * else is left alone: the request survives, and the next amount to appear is
   * another attempt.
   */
  private async dropIfUnreachable(
    event: TmaFiatDepositAmountsAvailableEvent,
    failure: TelegramFailure,
    error: unknown
  ): Promise<void> {
    const unreachable = UNREACHABLE_FAILURES.includes(failure)

    this.logger.warn(
      `Could not tell ${event.telegramId} about ${event.amountsUah.length} new amount(s): ` +
        `${describeTelegramFailure('sendMessage', error)}${
          unreachable ? ' — dropping their request' : ''
        }`
    )

    if (!unreachable) return

    try {
      await this.watchDb.removeById(event.watchId)
    } catch (removeError: unknown) {
      this.logger.error(
        `Could not drop the unreachable amount watch ${event.watchId}: ` +
          describeError(removeError)
      )
    }
  }

  /**
   * The link that opens the top-up screen, or `null` when this deployment has
   * no bot username configured.
   *
   * `null` rather than a throw: the shortcut is what makes a time-sensitive
   * message actionable, and a message without it is still worth far more than
   * no message at all.
   */
  private miniAppUrl(): string | null {
    const username = environments.TELEGRAM_BOT_USERNAME?.trim()

    return username ? miniAppLink(username, MiniAppStartParam.TOP_UP) : null
  }
}
