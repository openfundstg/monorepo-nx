// The decorators need it, and the app gets it from `main.ts`.
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { OrderWebhookReqDto } from './order-webhook.req.dto'

/**
 * The DTO's own rules, in isolation.
 *
 * **This suite cannot tell you whether the endpoint accepts a delivery**, and
 * once wrongly implied that it could. Every case here passed while the live
 * route returned 400 for the same payloads, because the global `ValidationPipe`
 * runs ahead of the route's own and rejected properties the DTO did not
 * declare. Validating the class directly never touches that.
 *
 * `webhook.pipeline.spec.ts` boots the real app and is the suite that answers
 * that question. What is checked here is narrower and still worth checking: the
 * field rules themselves, against every status and currency Transacto defines.
 *
 * The payload is a real one, from a production log line:
 *
 *   event=order.cancelled trader=592 order=1625353
 *   ref=4e005416-5e6d-4fe2-9b8a-745a82939d49 amount=500 status=9
 */
const delivery = (over: Record<string, unknown> = {}) => ({
  event: 'order.cancelled',
  trader_id: 592,
  timestamp: '2026-08-26T14:17:05.000Z',
  order: {
    id: 1_625_353,
    order_id: '4e005416-5e6d-4fe2-9b8a-745a82939d49',
    amount: 500,
    status_id: 9,
    cred: '4111111111111111',
    card_id: 2166,
    terminal_id: 27_339,
    currency_id: 5,
    datetime: '2026-08-26 14:17:05',
    deadline: null,
    executed_datetime: null,
    is_test: 0,
  },
  ...over,
})

const validate = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(OrderWebhookReqDto, body), {
    whitelist: true,
    forbidNonWhitelisted: false,
  })

/** Every failing constraint, flattened — `order.status_id: isEnum`, etc. */
const failures = (body: Record<string, unknown>): string[] =>
  validate(body).flatMap((error) =>
    error.children?.length
      ? error.children.flatMap((child) =>
          Object.keys(child.constraints ?? {}).map((c) => `${error.property}.${child.property}: ${c}`),
        )
      : Object.keys(error.constraints ?? {}).map((c) => `${error.property}: ${c}`),
  )

describe('OrderWebhookReqDto', () => {
  it('accepts a real delivery', () => {
    expect(failures(delivery())).toEqual([])
  })

  /** Transacto documents `is_test` on the order; it must not fail validation. */
  it('accepts the fields the OpenAPI spec documents', () => {
    expect(failures(delivery())).toEqual([])
  })

  /** The event may arrive only in the `X-Event` header. */
  it('accepts a body with no event', () => {
    const { event, ...withoutEvent } = delivery()

    expect(failures(withoutEvent)).toEqual([])
  })

  it('accepts a delivery with no timestamp', () => {
    const { timestamp, ...withoutTimestamp } = delivery()

    expect(failures(withoutTimestamp)).toEqual([])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('accepts status_id %i', (status_id) => {
    expect(failures(delivery({ order: { ...delivery().order, status_id } }))).toEqual([])
  })

  it.each([2, 3, 4, 5, 6, 7, 8, 9])('accepts currency_id %i', (currency_id) => {
    expect(failures(delivery({ order: { ...delivery().order, currency_id } }))).toEqual([])
  })

  /** A field Transacto adds later must not cost us a real order event. */
  it('ignores an unknown extra field rather than rejecting', () => {
    expect(failures(delivery({ something_new: 'whatever' }))).toEqual([])
  })
})
