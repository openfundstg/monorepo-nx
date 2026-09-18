import { HttpException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { describeTelegramFailure, telegramFailureOf } from 'src/shared/utils'
import type {
  AnswerCallbackQueryParams,
  CopyMessageParams,
  CreateForumTopicParams,
  DeleteMessageParams,
  EditForumTopicParams,
  ForumTopicParams,
  SendMediaGroupParams,
  SendMessageParams,
  SetWebhookParams,
  TelegramApiResponse,
  TelegramForumTopic,
  TelegramMessage,
  TelegramMessageId,
  TelegramUser,
  TelegramWebhookInfo
} from 'src/shared/interfaces'

/**
 * Transport for the Telegram Bot API. Builds a request, returns the result,
 * decides nothing.
 *
 * **The bot token is in the base URL, not in a header**, because that is where
 * Telegram wants it: `https://api.telegram.org/bot<token>/<method>`. The
 * consequence is that the request path is a credential, which is why nothing
 * here logs a raw axios error and why `describeTelegramFailure` exists instead
 * of the usual `describeError`.
 *
 * Every method rethrows on failure. Classification is the caller's job via
 * `telegramFailureOf` — a "user has blocked the bot" is a routine outcome for
 * one call site and a genuine error for another, and this layer cannot know
 * which.
 */
@Injectable()
export class TelegramBotApiService {
  private readonly logger = new Logger(TelegramBotApiService.name)

  constructor(private readonly httpService: HttpService) {}

  /** The bot behind the configured token — used at boot to prove the token works. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe', {})
  }

  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', params)
  }

  /**
   * Moves a message with no trace of where it came from — both directions.
   *
   * `forwardMessage` is deliberately absent from this service. It reads like
   * the right call for user → group, and it is not: Telegram gives it no
   * `reply_parameters`, so a forwarded message can never be shown as the reply
   * the user wrote. See `SupportRelayService` for the whole argument.
   */
  async copyMessage(params: CopyMessageParams): Promise<TelegramMessageId> {
    return this.call<TelegramMessageId>('copyMessage', params)
  }

  /**
   * Sends 2–10 media as one album.
   *
   * The only method here that names content rather than moving a message by id,
   * and the only one that can put an album back together: `copyMessage` copies
   * one message, and Telegram delivers an album as one update per item. See
   * `SupportAlbumService` for how the items are gathered first.
   */
  async sendMediaGroup(params: SendMediaGroupParams): Promise<TelegramMessage[]> {
    return this.call<TelegramMessage[]>('sendMediaGroup', params)
  }

  async createForumTopic(params: CreateForumTopicParams): Promise<TelegramForumTopic> {
    return this.call<TelegramForumTopic>('createForumTopic', params)
  }

  async editForumTopic(params: EditForumTopicParams): Promise<true> {
    return this.call<true>('editForumTopic', params)
  }

  /**
   * Removes one message. Needs `can_delete_messages` in the chat.
   *
   * Used on the service lines Telegram writes when a topic is renamed, closed
   * or reopened — never on the line that *created* a topic, whose id is the
   * topic itself.
   */
  async deleteMessage(params: DeleteMessageParams): Promise<true> {
    return this.call<true>('deleteMessage', params)
  }

  async closeForumTopic(params: ForumTopicParams): Promise<true> {
    return this.call<true>('closeForumTopic', params)
  }

  async reopenForumTopic(params: ForumTopicParams): Promise<true> {
    return this.call<true>('reopenForumTopic', params)
  }

  /**
   * Closes the loop on an inline key press.
   *
   * Must be called for every callback query, even with no text: until it is,
   * the client keeps a spinner on the button for up to a minute, and the user
   * concludes the bot is broken.
   */
  async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<true> {
    return this.call<true>('answerCallbackQuery', params)
  }

  async setWebhook(params: SetWebhookParams): Promise<true> {
    return this.call<true>('setWebhook', params)
  }

  /**
   * The webhook as Telegram holds it — which is the record that decides what
   * gets delivered here, and the only copy of it that matters.
   */
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.call<TelegramWebhookInfo>('getWebhookInfo', {})
  }

  /**
   * One POST, one envelope unwrapped.
   *
   * Telegram answers a failure with a 4xx *and* an `ok: false` body, so axios
   * throws and the `!ok` branch below is for the case it does not — a 200 that
   * still failed. Returning `response.data.result!` on such a body would hand
   * the caller `undefined` typed as the result, which is how a missing thread
   * id becomes a message sent to `NaN`.
   */
  private async call<T>(method: string, params: object): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<TelegramApiResponse<T>>(`/${method}`, params)
      )

      const { ok, result, description } = response.data

      if (!ok || result === undefined) {
        this.logger.error(
          `Telegram ${method} answered ok=${ok}: ${description ?? 'no description'}`
        )
        throw new InternalServerErrorException(ERROR.SUPPORT.TELEGRAM_API_FAILED)
      }

      return result
    } catch (error) {
      // Ours already — the `ok: false` branch above, which carries no credential.
      if (error instanceof HttpException) throw error

      // **The `AxiosError` stops here and goes no further.** Its `config.url` is
      // `/bot<token>/<method>`, so the bot's entire authentication rides on the
      // object; anything that logs it whole — Nest's unknown-exception handler
      // and BullMQ's job logger both do — prints the token. One did, into a
      // container log. What leaves this method instead is a verdict and a
      // sentence, both safe to print anywhere.
      const details = describeTelegramFailure(method, error)
      this.logger.warn(details)

      throw new InternalServerErrorException({
        ...ERROR.SUPPORT.TELEGRAM_API_FAILED,
        failure: telegramFailureOf(error),
        details
      })
    }
  }
}
