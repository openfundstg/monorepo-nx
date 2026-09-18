import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TelegramUpdateType } from 'src/shared/interfaces'
import type { TelegramWebhookInfo } from 'src/shared/interfaces'
import { describeTelegramFailure } from 'src/shared/utils'
import { SUPPORT_WEBHOOK_PATH } from 'src/modules/support/constants/support.constants'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'

/** The path any correctly configured webhook URL has to end in. */
const EXPECTED_SUFFIX = `/${SUPPORT_WEBHOOK_PATH}/webhook`

/** What this deployment asks Telegram to deliver, and all it can handle. */
const WANTED_UPDATES = [TelegramUpdateType.MESSAGE, TelegramUpdateType.CALLBACK_QUERY] as const

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
    if (!this.config.isEnabled) {
      this.logger.log('Support webhook registration skipped (no group id)')

      return
    }

    // Registration is optional; **knowing what is registered is not.** A
    // deployment that leaves the URL unset is trusting a webhook somebody set
    // up by hand, and that is exactly the arrangement in which an inline key
    // silently does nothing for weeks. So the audit runs either way.
    if (!this.config.webhookUrl) {
      this.logger.log('Support webhook registration skipped (no webhook URL)')
      await this.audit()

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
        allowed_updates: [...WANTED_UPDATES],
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

    await this.audit()
  }

  /**
   * Reads the live webhook back and says, out loud, what it will not deliver.
   *
   * **This exists because the failure it catches is completely silent on both
   * sides.** `allowed_updates` lives on Telegram's side and is whatever the
   * last `setWebhook` said; a bot registered before this deployment asked for
   * `callback_query` drops every inline key press before it is ever sent.
   * Nothing appears in any log, the key spins and stops, and the person
   * pressing it concludes the button is broken — which, from where they are
   * standing, it is.
   *
   * Never throws and never fails the boot. It reports; it decides nothing.
   */
  private async audit(): Promise<void> {
    let info: TelegramWebhookInfo

    try {
      info = await this.telegramApi.getWebhookInfo()
    } catch (error) {
      this.logger.warn(
        `Could not read the support webhook back: ${describeTelegramFailure('getWebhookInfo', error)}`
      )

      return
    }

    if (!info.url) {
      this.logger.error(
        'The support bot has NO webhook registered. Nothing a user sends or presses ' +
          'reaches this deployment — outbound messages still work, which is what makes ' +
          'this look like a broken button rather than a missing webhook. ' +
          'Set TELEGRAM_SUPPORT_WEBHOOK_URL and restart.'
      )

      return
    }

    if (this.config.webhookUrl && info.url !== this.config.webhookUrl) {
      this.logger.error(
        `The support bot delivers to ${info.url}, not to this deployment's ` +
          `${this.config.webhookUrl}. A bot has exactly one webhook, so something else owns it.`
      )
    }

    // Absent means Telegram's own default, which is **wider** than this list.
    // Only an explicit list can be too narrow, so only an explicit list is read.
    const missing = info.allowed_updates
      ? WANTED_UPDATES.filter((wanted) => !info.allowed_updates?.includes(wanted))
      : []

    if (missing.length > 0) {
      this.logger.error(
        `The support webhook does not deliver ${missing.join(', ')} — Telegram drops those ` +
          'before they are sent. Every inline key on this bot will appear to do nothing. ' +
          'Set TELEGRAM_SUPPORT_WEBHOOK_URL so this service can re-register it.'
      )
    }

    // Telegram's own account of deliveries it could not make: a wrong secret, a
    // TLS failure, a 500 from us. Printed whole because it names ours, not a
    // user's, and a webhook failing every delivery reads identically to one
    // that is not registered at all.
    if (info.last_error_message) {
      this.logger.warn(
        `Telegram's last delivery to the support webhook failed: ${info.last_error_message} ` +
          `(${info.pending_update_count} update(s) pending)`
      )
    }
  }
}
