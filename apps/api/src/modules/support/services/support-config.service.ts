import { ERROR } from '@transacto/contracts'
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import environments from 'src/environments'

/**
 * The support bot's configuration, read once and answered for.
 *
 * Every other service in this module asks here rather than touching
 * `environments` itself, for two reasons. The group id arrives as a string and
 * has to become a number exactly once — a `Number(env)` at three call sites is
 * three chances to produce `NaN` and send a message to nowhere. And the module
 * has to be able to boot *unconfigured*: an existing deployment that has no
 * support group must keep running, with the webhook endpoint answering and
 * dropping updates rather than the whole API failing to start.
 */
@Injectable()
export class SupportConfigService {
  private readonly logger = new Logger(SupportConfigService.name)

  /** The forum supergroup, or `null` when support is not configured here. */
  readonly groupId: number | null

  /** Shared secret Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`. */
  readonly webhookSecret: string

  /** Full public URL of the webhook. Empty means "do not register one". */
  readonly webhookUrl: string

  constructor() {
    const rawGroupId = Number(environments.TELEGRAM_SUPPORT_GROUP_ID)
    this.groupId = Number.isSafeInteger(rawGroupId) && rawGroupId !== 0 ? rawGroupId : null

    this.webhookSecret = environments.TELEGRAM_SUPPORT_WEBHOOK_SECRET?.trim() ?? ''
    this.webhookUrl = environments.TELEGRAM_SUPPORT_WEBHOOK_URL?.trim() ?? ''

    if (!this.isEnabled) {
      this.logger.warn(
        'TELEGRAM_SUPPORT_GROUP_ID is not set — the support bot is inert: ' +
          'inbound updates will be acknowledged and dropped.'
      )
    }
  }

  get isEnabled(): boolean {
    return this.groupId !== null
  }

  /** The group id, or a 500 — for paths that cannot run without one. */
  requireGroupId(): number {
    if (this.groupId === null)
      throw new InternalServerErrorException(ERROR.CONFIG.MISSING_SUPPORT_GROUP_ID)

    return this.groupId
  }
}
