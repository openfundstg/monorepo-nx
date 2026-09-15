/** The parts of an inbound delivery worth naming in a log line. */
export interface WebhookLogFields {
  event?: unknown
  trader_id?: unknown
  timestamp?: unknown
  order?: {
    id?: unknown
    order_id?: unknown
    amount?: unknown
    status_id?: unknown
  } | null
}

/** Shown in place of a field the payload did not carry. */
const UNKNOWN = '?'

const show = (value: unknown): string =>
  value === undefined || value === null || value === '' ? UNKNOWN : String(value)

/**
 * One line describing a delivery: what it is, whose it is, and which order.
 *
 * **Identifiers and the amount only — never the payload.** `WebhookOrderDto.cred`
 * is a card number, and a log is the last place it should end up; dumping the
 * body would put one there on every single delivery. Everything named here is an
 * id already written to `orders`, plus the amount, which is what makes a line
 * useful for reconciling against the order it created.
 *
 * Defensive about every field because this runs *before* the ValidationPipe, so
 * that a payload which fails validation is still visible rather than silently
 * 400ing. Nothing here may throw — a logging helper that crashes would turn a
 * malformed delivery into a 500.
 */
export const describeDelivery = (body: Partial<WebhookLogFields> | undefined): string => {
  const order = body?.order ?? undefined

  return (
    `event=${show(body?.event)} trader=${show(body?.trader_id)} ` +
    `order=${show(order?.id)} ref=${show(order?.order_id)} ` +
    `amount=${show(order?.amount)} status=${show(order?.status_id)}`
  )
}

/** The header Transacto names the event in. */
export const WEBHOOK_EVENT_HEADER = 'x-event'
