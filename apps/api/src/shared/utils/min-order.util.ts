import { DEFAULT_MIN_ORDER_KOPECKS } from '@transacto/contracts'

/**
 * The smallest order Transacto will route to a terminal, in UAH kopecks.
 *
 * Re-exported from `@transacto/contracts` rather than declared here. It moved
 * when the Mini App started having to name the figure to the user — the
 * remainder choice offers to return "anything under ₴300" — and a client
 * working from its own copy would be describing a different product from the
 * one the server settles.
 *
 * Everything the old comment said still holds. Three rules hang off it and must
 * not drift apart: the jar-full alert that cues a trader to pay the rest in by
 * hand, the funding rule that lets an order close on a top-up no order accounts
 * for, and now the remainder policy. They are all the same moment — a terminal
 * is created with `max_turnover` equal to its target, so once the jar is within
 * this of its goal there is no room left for an order big enough to exist.
 */
export { DEFAULT_MIN_ORDER_KOPECKS }

/**
 * Reads the minimum order size from configuration, falling back to the default.
 *
 * Unlike the exchange rate this *does* default: it is a threshold rather than a
 * price, so a missing value has a safe reading. Zero is honoured — it means
 * every kopeck must arrive as a matched order — but a negative or unparseable
 * value is not, since neither expresses an intent worth guessing at.
 */
export const parseMinOrderKopecks = (value: string | undefined): number => {
  const parsed = Number(value)

  return value !== undefined && value !== '' && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_MIN_ORDER_KOPECKS
}
