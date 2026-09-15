import { describeDelivery } from './webhook-log.util'

/** A delivery as Transacto sends it, card number and all. */
const delivery = () => ({
  event: 'order.created',
  trader_id: 592,
  timestamp: '2026-08-25T18:30:35.839Z',
  order: {
    id: 1_615_180,
    order_id: 'ORD-1615180',
    amount: 304,
    status_id: 2,
    cred: '4441111122223333',
  },
})

describe('describeDelivery', () => {
  it('names what arrived, whose it is and which order', () => {
    expect(describeDelivery(delivery())).toBe(
      'event=order.created trader=592 order=1615180 ref=ORD-1615180 amount=304 status=2',
    )
  })

  /**
   * `WebhookOrderDto.cred` is a card number. Dumping the payload would put one
   * in the log on every single delivery, so the line is built from named fields
   * rather than from the body.
   */
  it('never lets the card number reach the log', () => {
    const line = describeDelivery(delivery())

    expect(line).not.toContain('4441111122223333')
    expect(line).not.toContain('cred')
  })

  /**
   * This runs before the ValidationPipe, precisely so a payload that fails
   * validation is still visible. It may never throw — a logging helper that
   * crashed would turn a malformed delivery into a 500.
   */
  it.each([
    ['nothing at all', undefined],
    ['an empty body', {}],
    ['a null order', { event: 'order.paid', trader_id: 1, order: null }],
    ['an order with no fields', { event: 'order.paid', order: {} }],
  ])('survives %s', (_label, body) => {
    expect(() => describeDelivery(body as never)).not.toThrow()
  })

  it('marks absent fields rather than printing undefined', () => {
    expect(describeDelivery({})).toBe(
      'event=? trader=? order=? ref=? amount=? status=?',
    )
  })

  /** Zero is a real amount; only absence is unknown. */
  it('prints a zero amount as zero', () => {
    expect(describeDelivery({ order: { amount: 0 } })).toContain('amount=0')
  })
})
