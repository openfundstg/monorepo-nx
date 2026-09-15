import {
  Controller,
  Post,
  Logger,
  HttpCode,
  HttpStatus,
  Body,
  BadRequestException,
  UseGuards,
  Req
} from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import { WebhookSignatureGuard } from 'src/modules/webhook/guards/webhook-signature.guard'
import { Public, SkipCsrf } from 'src/modules/auth'
import { OrderPollingService } from 'src/modules/order-polling'
import { WebhookEvent } from 'src/modules/webhook/enums/webhook-event.enum'
import type { AuthenticatedRequest } from 'src/shared/interfaces/authenticated-request.interface'
import { OrderWebhookReqDto } from 'src/modules/webhook/dto/order-webhook.req.dto'
import { WEBHOOK_EVENT_HEADER } from 'src/modules/webhook/utils/webhook-log.util'
import { parseOrderWebhook } from 'src/modules/webhook/utils/webhook-payload.util'

/** Every event Transacto can send, whether or not this endpoint acts on it. */
const KNOWN_EVENTS: ReadonlySet<WebhookEvent> = new Set(Object.values(WebhookEvent))

/** The events this endpoint acts on; everything else is acknowledged and dropped. */
const HANDLED_EVENTS: ReadonlySet<WebhookEvent> = new Set([
  WebhookEvent.ORDER_CREATED,
  WebhookEvent.ORDER_PAID,
  WebhookEvent.ORDER_CANCELLED
])

@Controller('webhook/trader')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name)

  constructor(private readonly orderPollingService: OrderPollingService) {}

  /**
   * Webhook endpoint to receive order events from Transacto CRM.
   * POST /webhook/trader
   *
   * The WebhookSignatureGuard validates X-Signature using the
   * trader-specific apiToken and attaches the trader to the request.
   */
  // Not a user: Transacto is a server calling us. It proves identity with an
  // HMAC signature over the raw body, which is a scheme of its own — so it is
  // @Public() as far as user-type auth goes, and WebhookSignatureGuard supplies
  // the actual authentication. @SkipCsrf() because a third-party server can
  // never hold one of our CSRF tokens.
  @Post('')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  @SkipCsrf()
  @UseGuards(WebhookSignatureGuard)
  //
  // **`unknown` is load-bearing — do not annotate this with the DTO.**
  //
  // The global `ValidationPipe` is registered with `forbidNonWhitelisted: true`,
  // and a method-level `@UsePipes` does not replace it: NestJS runs global pipes
  // first and every bound pipe in turn. This route used to declare the DTO plus
  // a lenient `@UsePipes`, and the global pipe rejected any delivery carrying a
  // property the DTO did not declare — with a 400 that, at the time, no
  // exception filter logged. A verified webhook simply vanished.
  //
  // `unknown` compiles to the `Object` metatype, which `ValidationPipe` skips,
  // so the body arrives untouched and `parseOrderWebhook` validates it on terms
  // that suit a third-party payload. See that function for the full account.
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<void> {
    const trader = req.trader
    const startedAt = Date.now()

    const { payload, failures } = parseOrderWebhook(body)
    if (!payload) {
      this.logger.error(
        `❌ Webhook from trader ${trader?.traderId} failed validation on: ${failures.join(', ')}`
      )
      throw new BadRequestException(ERROR.WEBHOOK.INVALID_PAYLOAD)
    }

    const event = this.resolveEvent(payload, req)

    if (!event) {
      this.logger.warn(
        `Webhook from trader ${payload.trader_id} named no event, in the body or the header`
      )
      return
    }

    // The arrival itself is logged by WebhookSignatureGuard, which sees every
    // delivery including the ones it rejects. What is worth saying here is what
    // we *did* with it: an event silently ignored and an order silently handled
    // looked identical in the log before, and both ended in the same 204.
    const finish = (outcome: string): void => {
      this.logger.log(
        `✅ Webhook ${event} (order ${payload.order?.id}, trader ${payload.trader_id}): ` +
          `${outcome} in ${Date.now() - startedAt}ms`
      )
    }

    if (!HANDLED_EVENTS.has(event)) {
      finish('ignored — not an event we act on')
      return
    }

    const order = payload.order
    if (!order) {
      this.logger.warn(
        `Webhook ${event} from trader ${payload.trader_id} carried no order data`
      )
      return
    }

    try {
      if (event === WebhookEvent.ORDER_CREATED) {
        await this.orderPollingService.handleWebhookOrder(trader, order)
        finish('order enqueued for polling')
      } else if (event === WebhookEvent.ORDER_PAID) {
        await this.orderPollingService.handleOrderPaid(trader, order)
        finish('order marked paid')
      } else {
        await this.orderPollingService.handleOrderCancelled(trader, order)
        finish('order marked cancelled')
      }
    } catch (error: unknown) {
      // Re-thrown, so Transacto sees a non-2xx and retries the delivery — but
      // not before it is in the log with the order it was for. A failure that
      // only surfaced as a stack trace from the global filter gave no way to
      // tell which delivery had been lost.
      this.logger.error(
        `❌ Webhook ${event} (order ${order.id}, trader ${payload.trader_id}) failed ` +
          `after ${Date.now() - startedAt}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        error instanceof Error ? error.stack : undefined
      )
      throw error
    }
  }

  /**
   * Which event this delivery is, from the body or the `X-Event` header.
   *
   * Transacto documents the event as a header and the payload schema also
   * carries it, so both are accepted — the body first, since it is the one the
   * signature covers. A header-only delivery used to fail validation outright
   * and come back 400, which is a real order event lost over where its name was
   * written.
   *
   * An unrecognised value is `undefined` rather than a throw: a new event type
   * Transacto starts sending is not an error on our side, and a 500 would make
   * them retry it forever.
   */
  private resolveEvent(
    payload: OrderWebhookReqDto,
    req: AuthenticatedRequest
  ): WebhookEvent | undefined {
    if (payload.event) return payload.event

    const header = req.headers[WEBHOOK_EVENT_HEADER]
    const named = Array.isArray(header) ? header[0] : header

    return KNOWN_EVENTS.has(named as WebhookEvent) ? (named as WebhookEvent) : undefined
  }
}
