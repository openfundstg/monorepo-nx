import type { TransactoWebhookOrder } from 'src/shared/interfaces'

/**
 * A Transacto timestamp: `YYYY-MM-DD HH:mm:ss`, with no zone on it at all.
 *
 * Anchored rather than loose, so a value that is merely *similar* — a date on
 * its own, an ISO string with a `T`, something with an offset attached — is
 * refused rather than half-read.
 */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/**
 * Reads one as epoch milliseconds **in an arbitrary fixed zone**.
 *
 * `Date.UTC` is used for that and nothing else: the result is not claimed to be
 * UTC, only to be consistent, so that two values read this way can be
 * subtracted. Parsing with `new Date(string)` would have been worse than wrong
 * — it applies the *server's* zone, which is a different constant on a laptop
 * and in the container.
 */
const readInSomeZone = (value: string): number | null => {
  const match = TIMESTAMP.exec(value.trim())
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)
}

/**
 * How long Transacto gives the payer, in milliseconds.
 *
 * **A difference, deliberately — never either timestamp on its own.**
 *
 * Transacto states `datetime` and `deadline` with no zone, and this repository
 * has already been bitten once by guessing which one they are in: the operator
 * panel's HTML tables are UTC+3 while the JSON on the same host is UTC, proven
 * against the `Date` header of the response that carried both. The Trader API
 * is a third surface and nothing here has ever had to interpret its wall clock,
 * so nothing here is entitled to assume one.
 *
 * It does not need to. Whatever zone the pair is in, it is the *same* zone for
 * both, so subtracting them cancels it: six minutes is six minutes in every
 * offset there is. The window is then anchored to our own clock at the moment
 * the order reaches us, which is a time this process actually knows.
 *
 * `null` when either timestamp is missing or unreadable — the caller falls back
 * to a configured window rather than inventing a deadline out of a bad parse.
 */
export const payerWindowMs = (order: {
  datetime?: string | null
  deadline?: string | null
}): number | null => {
  const { datetime, deadline } = order
  if (!datetime || !deadline) return null

  const from = readInSomeZone(datetime)
  const until = readInSomeZone(deadline)
  if (from === null || until === null) return null

  const window = until - from

  // A deadline at or before the creation is not a short window, it is a
  // contradiction — and a zero-length one would mark the order overdue on
  // arrival, stopping a terminal nothing is wrong with.
  return window > 0 ? window : null
}

/**
 * When Transacto's window closes, on our clock.
 *
 * `arrivedAt` is when this process learned of the order — the webhook is
 * delivered on creation, so the two are seconds apart, and those seconds are
 * spent in the seller's favour rather than against them.
 */
export const payerDeadlineFrom = (
  order: Pick<TransactoWebhookOrder, 'datetime' | 'deadline'>,
  arrivedAt: Date
): Date | null => {
  const window = payerWindowMs(order)
  return window === null ? null : new Date(arrivedAt.getTime() + window)
}
