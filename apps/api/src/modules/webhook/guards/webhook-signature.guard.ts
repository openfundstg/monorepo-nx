import { ERROR } from '@transacto/contracts'
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger
} from '@nestjs/common'
import * as crypto from 'crypto'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { AuthenticatedRequest } from 'src/shared/interfaces/authenticated-request.interface'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { Trader } from 'src/modules/repositories/trader-db/schemas'
import { describeDelivery, type WebhookLogFields } from 'src/modules/webhook/utils/webhook-log.util'

/**
 * Guard that validates webhook requests using HMAC-SHA256 signature.
 * Extracts trader_id from request body, loads the trader's apiToken,
 * and verifies the X-Signature header against the raw request body.
 *
 * On success, attaches the trader document to request for downstream use.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name)

  constructor(private readonly traderDbService: TraderDbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>()

    // Announced here, before anything is validated, because this guard is the
    // first code that sees a delivery — and the deliveries worth seeing most
    // are the ones that never reach the controller. Every rejection below used
    // to be either silent or a bare warning with no idea what had arrived.
    //
    // Read off the raw body rather than the DTO: this runs before the
    // ValidationPipe, so a payload that fails validation is still logged.
    const body = request.body as Partial<WebhookLogFields> | undefined
    this.logger.log(
      `📥 Webhook delivery: ${describeDelivery(body)}`
    )

    const traderId = Number(body?.trader_id)
    if (!traderId || isNaN(traderId)) {
      this.logger.warn(`Webhook rejected: no usable trader_id in the payload`)
      throw new BadRequestException(ERROR.WEBHOOK.MISSING_TRADER_ID)
    }

    const signature = request.headers['x-signature'] as string | undefined
    if (!signature) {
      this.logger.warn(`Webhook rejected: no X-Signature header (trader ${traderId})`)
      throw new BadRequestException(ERROR.WEBHOOK.INVALID_SIGNATURE)
    }

    // Load trader from DB to get the per-trader apiToken
    const trader = await this.traderDbService.findByTraderId(traderId)
    if (!trader) {
      this.logger.warn(`Webhook rejected: unknown trader ${traderId}`)
      throw new UnauthorizedException(ERROR.WEBHOOK.UNKNOWN_TRADER)
    }

    if (!trader.isActive) {
      this.logger.warn(`Webhook rejected: trader ${traderId} is inactive`)
      throw new UnauthorizedException(ERROR.WEBHOOK.TRADER_INACTIVE)
    }

    // Compute HMAC-SHA256 signature using trader's apiToken as secret
    const rawBody = request.rawBody ? request.rawBody : Buffer.from(JSON.stringify(request.body))

    const expectedSignature = crypto
      .createHmac('sha256', trader.apiToken)
      .update(rawBody)
      .digest('hex')

    if (signature !== expectedSignature) {
      // The expected signature is deliberately not logged. It is an HMAC over a
      // body an attacker chose, keyed with the trader's `apiToken` — printing it
      // hands out a valid signature for that exact payload, and enough of them
      // are a foothold on the token itself. What arrived is enough to debug a
      // mismatch; what we computed is a secret.
      this.logger.error(
        `Webhook rejected: signature mismatch for trader ${traderId} (received ${signature})`
      )
      throw new UnauthorizedException(ERROR.WEBHOOK.INVALID_SIGNATURE)
    }

    this.logger.debug(`Webhook signature verified for trader ${traderId}`)

    // Attach trader to request for use in the controller
    ;(request as AuthenticatedRequest).trader = trader
    return true
  }
}
