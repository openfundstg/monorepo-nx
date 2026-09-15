import { ERROR } from '@transacto/contracts'
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException
} from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import type { Request } from 'express'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'

/** The header Telegram echoes back the `secret_token` given to `setWebhook` in. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

/**
 * Proves a delivery came from Telegram.
 *
 * The endpoint is public and its path is guessable, so this header is the only
 * thing between the support group and anyone willing to POST a JSON body — one
 * that would be relayed verbatim to a real customer as if an operator had
 * written it. Telegram offers no signature scheme; the shared secret is the
 * whole mechanism, which is why an unset secret fails closed rather than
 * waving the request through.
 */
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  private readonly logger = new Logger(TelegramWebhookGuard.name)

  constructor(private readonly config: SupportConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const expected = this.config.webhookSecret

    if (!expected) {
      this.logger.error('TELEGRAM_SUPPORT_WEBHOOK_SECRET is not set; refusing every delivery')
      throw new InternalServerErrorException(ERROR.CONFIG.MISSING_SUPPORT_WEBHOOK_SECRET)
    }

    const received = request.headers[SECRET_HEADER]

    if (typeof received !== 'string' || !this.matches(received, expected)) {
      this.logger.warn('Telegram webhook rejected: secret token missing or wrong')
      throw new UnauthorizedException(ERROR.SUPPORT.INVALID_WEBHOOK_SECRET)
    }

    return true
  }

  /**
   * Constant-time comparison, after a length check.
   *
   * `timingSafeEqual` throws on mismatched lengths rather than returning false,
   * so the length is compared first — and comparing lengths is not the leak it
   * looks like: Telegram's secret is chosen by us and fixed, so its length is
   * not a secret worth protecting. The content is.
   */
  private matches(received: string, expected: string): boolean {
    const a = Buffer.from(received)
    const b = Buffer.from(expected)

    return a.length === b.length && timingSafeEqual(a, b)
  }
}
