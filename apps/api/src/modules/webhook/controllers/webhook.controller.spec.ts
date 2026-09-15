import { Logger } from '@nestjs/common'
import { WebhookController } from './webhook.controller'
import { WebhookEvent } from 'src/modules/webhook/enums/webhook-event.enum'
import type { OrderPollingService } from 'src/modules/order-polling'
import type { OrderWebhookReqDto } from 'src/modules/webhook/dto/order-webhook.req.dto'
import type { AuthenticatedRequest } from 'src/shared/interfaces/authenticated-request.interface'

const TRADER = { traderId: 592, apiToken: 'token' }

const order = () => ({
  id: 1_615_180,
  order_id: 'ORD-1615180',
  amount: 304,
  status_id: 2,
  card_id: 100,
})

const payload = (over: Record<string, unknown> = {}) =>
  ({ trader_id: TRADER.traderId, order: order(), ...over }) as unknown as OrderWebhookReqDto

const request = (headers: Record<string, unknown> = {}) =>
  ({ trader: TRADER, headers }) as unknown as AuthenticatedRequest

describe('WebhookController', () => {
  let polling: {
    handleWebhookOrder: jest.Mock
    handleOrderPaid: jest.Mock
    handleOrderCancelled: jest.Mock
  }
  let controller: WebhookController

  beforeEach(() => {
    polling = {
      handleWebhookOrder: jest.fn().mockResolvedValue(undefined),
      handleOrderPaid: jest.fn().mockResolvedValue(undefined),
      handleOrderCancelled: jest.fn().mockResolvedValue(undefined),
    }
    controller = new WebhookController(polling as unknown as OrderPollingService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  describe('where the event is named', () => {
    it('takes it from the body', async () => {
      await controller.handleWebhook(payload({ event: WebhookEvent.ORDER_CREATED }), request())

      expect(polling.handleWebhookOrder).toHaveBeenCalled()
    })

    /**
     * Transacto documents the event as the `X-Event` header. Requiring it on
     * the body meant a header-only delivery failed validation and came back
     * 400 — a real order event lost over where its name was written.
     */
    it('falls back to the X-Event header', async () => {
      await controller.handleWebhook(payload(), request({ 'x-event': 'order.created' }))

      expect(polling.handleWebhookOrder).toHaveBeenCalled()
    })

    /** The body is what the signature covers, so it wins. */
    it('prefers the body over a disagreeing header', async () => {
      await controller.handleWebhook(
        payload({ event: WebhookEvent.ORDER_PAID }),
        request({ 'x-event': 'order.cancelled' }),
      )

      expect(polling.handleOrderPaid).toHaveBeenCalled()
      expect(polling.handleOrderCancelled).not.toHaveBeenCalled()
    })

    it('does nothing when neither names an event', async () => {
      await controller.handleWebhook(payload(), request())

      expect(polling.handleWebhookOrder).not.toHaveBeenCalled()
      expect(polling.handleOrderPaid).not.toHaveBeenCalled()
      expect(polling.handleOrderCancelled).not.toHaveBeenCalled()
    })

    /**
     * A new event type is not an error on our side, and throwing would make
     * Transacto retry it forever.
     */
    it('ignores an event it does not know', async () => {
      await expect(
        controller.handleWebhook(payload(), request({ 'x-event': 'order.teleported' })),
      ).resolves.toBeUndefined()
    })
  })

  describe('dispatch', () => {
    it.each([
      [WebhookEvent.ORDER_CREATED, 'handleWebhookOrder'],
      [WebhookEvent.ORDER_PAID, 'handleOrderPaid'],
      [WebhookEvent.ORDER_CANCELLED, 'handleOrderCancelled'],
    ] as const)('routes %s', async (event, handler) => {
      await controller.handleWebhook(payload({ event }), request())

      expect(polling[handler]).toHaveBeenCalledWith(TRADER, expect.objectContaining({ id: 1_615_180 }))
    })

    /** Acknowledged and dropped — Transacto sends these, we do not act on them. */
    it.each([WebhookEvent.APPEAL_CREATED, WebhookEvent.APPEAL_UPDATED, WebhookEvent.BALANCE_LOW])(
      'acknowledges %s without acting',
      async (event) => {
        await controller.handleWebhook(payload({ event }), request())

        expect(polling.handleWebhookOrder).not.toHaveBeenCalled()
      },
    )

    it('does not act on a delivery with no order', async () => {
      await controller.handleWebhook(
        payload({ event: WebhookEvent.ORDER_PAID, order: undefined }),
        request(),
      )

      expect(polling.handleOrderPaid).not.toHaveBeenCalled()
    })
  })

  /** Re-thrown so Transacto retries — but named in the log first. */
  it('logs and rethrows a handler failure', async () => {
    polling.handleWebhookOrder.mockRejectedValue(new Error('mongo is down'))

    await expect(
      controller.handleWebhook(payload({ event: WebhookEvent.ORDER_CREATED }), request()),
    ).rejects.toThrow('mongo is down')

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('order 1615180'),
      expect.anything(),
    )
  })
})
