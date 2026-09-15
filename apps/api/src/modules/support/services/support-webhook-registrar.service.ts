import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TelegramUpdateType } from 'src/shared/interfaces'
import { describeTelegramFailure } from 'src/shared/utils'
import { SUPPORT_WEBHOOK_PATH } from 'src/modules/support/constants/support.constants'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'

/** The path any correctly configured webhook URL has to end in. */
const EXPECTED_SUFFIX = `/${SUPPORT_WEBHOOK_PATH}/webhook`

@Injectable()
export class SupportWebhookRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(SupportWebhookRegistrarService.name)

  constructor(
    private readonly config: SupportConfigService,
    private readonly telegramApi: TelegramBotApiService
  ) {}

  /**
   * Points the bot at this deployment — but only where it is asked to.
   *
   * **A bot has exactly one webhook.** Registering one here silently revokes
   * whichever URL was registered before, so a developer running the API locally
   * with production's `.env` would take the live support bot offline and route
   * every customer's message into their laptop. That is why registration is
   * gated on `TELEGRAM_SUPPORT_WEBHOOK_URL` being set explicitly rather than
   * derived from anything: an unset variable means "leave the bot alone", which
   * is the right default for every environment except the one that owns it.
   *
   * A failure is logged, never thrown. The API has four other reasons to exist
   * and must not fail to boot because Telegram was unreachable for a second.
   */
  async onModuleInit(): Promise<void> {
    if (!this.config.isEnabled || !this.config.webhookUrl) {
      this.logger.log('Support webhook registration skipped (no group id or no webhook URL)')

      return
    }

    if (!this.config.webhookUrl.endsWith(EXPECTED_SUFFIX)) {
      this.logger.warn(
        `TELEGRAM_SUPPORT_WEBHOOK_URL does not end in ${EXPECTED_SUFFIX}. ` +
          'Registering it anyway — deliveries will only arrive if a proxy rewrites the path.'
      )
    }

    try {
      const bot = await this.telegramApi.getMe()

      await this.telegramApi.setWebhook({
        url: this.config.webhookUrl,
        secret_token: this.config.webhookSecret,
        // Everything else Telegram might send is dropped at its end rather than
        // ours — the cheapest possible filter, and the reason this endpoint
        // cannot be flooded with reactions, polls or member updates.
        //
        // `callback_query` is here for the language keys; without it Telegram
        // silently drops every press and the menu appears to do nothing.
        allowed_updates: [TelegramUpdateType.MESSAGE, TelegramUpdateType.CALLBACK_QUERY],
        // Pending updates are kept: they are customers' unanswered questions
        // from whatever outage or deploy caused the gap.
        drop_pending_updates: false
      })

      this.logger.log(
        `Support webhook registered for @${bot.username ?? bot.id} → ${this.config.webhookUrl}`
      )
    } catch (error) {
      this.logger.error(
        `Could not register the support webhook: ${describeTelegramFailure('setWebhook', error)}`
      )
    }
  }
}
