import 'reflect-metadata'
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_PIPE } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { WebhookController } from './webhook.controller'
import { WebhookSignatureGuard } from 'src/modules/webhook/guards/webhook-signature.guard'
import { OrderPollingService } from 'src/modules/order-polling'
import { AllExceptionsFilter } from 'src/shared/filters'

const TRADER = { traderId: 592, apiToken: 'token' }

/** The delivery from the report, field for field. */
const delivery = (over: Record<string, unknown> = {}) => ({
  event: 'order.cancelled',
  trader_id: TRADER.traderId,
  timestamp: '2026-08-26T17:33:05.000Z',
  order: {
    id: 1_627_823,
    order_id: '47902029',
    amount: 300,
    status_id: 9,
    card_id: 100,
    currency_id: 5,
  },
  ...over,
})

/**
 * The real request pipeline, not the DTO on its own.
 *
 * The bug this suite exists for was invisible to a DTO test. `plainToInstance` +
 * `validateSync` with the *route's* options passed every payload thrown at it —
 * twenty-five cases of it — while the live endpoint rejected the same payloads
 * with a 400, because the global pipe runs first and the route's options were
 * never the ones deciding. Only a booted app can tell the two apart.
 */
describe('the webhook route, end to end', () => {
  let app: INestApplication
  let url: string
  let polling: {
    handleWebhookOrder: jest.Mock
    handleOrderPaid: jest.Mock
    handleOrderCancelled: jest.Mock
  }

  beforeEach(async () => {
    polling = {
      handleWebhookOrder: jest.fn().mockResolvedValue(undefined),
      handleOrderPaid: jest.fn().mockResolvedValue(undefined),
      handleOrderCancelled: jest.fn().mockResolvedValue(undefined),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: OrderPollingService, useValue: polling },
        // Exactly as AppModule registers them, which is the whole point.
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
          }),
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      // The signature is verified elsewhere; here it only has to attach the trader.
      .overrideGuard(WebhookSignatureGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { trader: unknown } } }) => {
          context.switchToHttp().getRequest().trader = TRADER
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
    await app.listen(0)
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1')

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await app.close()
  })

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/webhook/trader`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('accepts and acts on the delivery as Transacto sends it', async () => {
    const response = await post(delivery())

    expect(response.status).toBe(204)
    expect(polling.handleOrderCancelled).toHaveBeenCalledWith(
      TRADER,
      expect.objectContaining({ id: 1_627_823 }),
    )
  })

  /**
   * The regression. A property our DTO does not declare used to be rejected by
   * the global pipe with `forbidNonWhitelisted: true`, before the handler and
   * before the route's own lenient pipe had any say — and, with no exception
   * filter, without a single line in the log.
   */
  it('acts on a delivery carrying a field we have never heard of', async () => {
    const response = await post(
      delivery({ signature_version: 2, order: { ...delivery().order, rate: '41.85' } }),
    )

    expect(response.status).toBe(204)
    expect(polling.handleOrderCancelled).toHaveBeenCalled()
  })

  it('acts on one carrying an unknown top-level field only', async () => {
    const response = await post(delivery({ retry_count: 3 }))

    expect(response.status).toBe(204)
    expect(polling.handleOrderCancelled).toHaveBeenCalled()
  })

  /** Transacto documents the event as a header; the body field is additional. */
  it('acts on a header-only delivery', async () => {
    const { event, ...withoutEvent } = delivery()
    void event

    const response = await post(withoutEvent, { 'x-event': 'order.cancelled' })

    expect(response.status).toBe(204)
    expect(polling.handleOrderCancelled).toHaveBeenCalled()
  })

  it.each([
    ['order.created', 'handleWebhookOrder'],
    ['order.paid', 'handleOrderPaid'],
    ['order.cancelled', 'handleOrderCancelled'],
  ] as const)('routes %s', async (event, handler) => {
    const response = await post(delivery({ event }))

    expect(response.status).toBe(204)
    expect(polling[handler]).toHaveBeenCalled()
  })

  /** Strict where it counts: a field we act on being wrong is still a 400. */
  it('rejects a delivery whose status is not one Transacto defines', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    const response = await post(delivery({ order: { ...delivery().order, status_id: 99 } }))

    expect(response.status).toBe(400)
    expect(polling.handleOrderCancelled).not.toHaveBeenCalled()
    // Named, not silent — and by property path, never by value.
    expect(error).toHaveBeenCalledWith(expect.stringContaining('order.status_id'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('400 POST /webhook/trader'))
  })

  /**
   * The card number must not reach a log line, and class-validator's default
   * messages quote the value that failed.
   */
  it('never logs the value of a field that failed', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await post(delivery({ order: { ...delivery().order, status_id: 99, cred: '5168750000003407' } }))

    const logged = error.mock.calls.flat().join(' ')
    expect(logged).not.toContain('5168750000003407')
  })

  it('acknowledges an event it does not act on', async () => {
    const response = await post(delivery({ event: 'balance.low' }))

    expect(response.status).toBe(204)
    expect(polling.handleWebhookOrder).not.toHaveBeenCalled()
  })

  /**
   * `balance.low` and the appeal events carry no order. `order` used to be a
   * required DTO field, so each of them came back 400 — and Transacto retries a
   * 400, so a delivery we would have dropped anyway was redelivered forever.
   */
  it('acknowledges a non-order event that carries no order at all', async () => {
    const { order, ...withoutOrder } = delivery({ event: 'balance.low' })
    void order

    const response = await post(withoutOrder)

    expect(response.status).toBe(204)
  })

  /** An order event with no order is a warning, not a retry loop. */
  it('acknowledges an order event whose order is missing', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { order, ...withoutOrder } = delivery()
    void order

    const response = await post(withoutOrder)

    expect(response.status).toBe(204)
    expect(polling.handleOrderCancelled).not.toHaveBeenCalled()
  })
})
