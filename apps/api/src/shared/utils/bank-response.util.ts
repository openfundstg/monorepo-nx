import { ERROR } from '@transacto/contracts'
import { BadRequestException } from '@nestjs/common'
import type {
  MonoRawResponse,
  PrivatRawResponse,
  PumbRawResponse,
  UnifiedBankBalance
} from 'src/shared/interfaces'

/**
 * Pure adapters from each bank's raw payload to {@link UnifiedBankBalance}.
 *
 * No HTTP, no injection, no state — give them a parsed body and they either
 * return a balance or throw. Everything bank-shaped and weird lives here so the
 * strategies stay readable.
 *
 * The raw shapes themselves live in `shared/interfaces/bank-api.interface.ts`,
 * captured from live calls. Contract there, arithmetic here.
 */

/** PUMB reports an empty moneybox as this constant, negated. See {@link adaptPumbBalance}. */
const PUMB_EMPTY_BALANCE_OFFSET = 99_999_999_999_900

/** Anything below this is an offset-encoded value rather than a real balance. */
const PUMB_OFFSET_THRESHOLD = -90_000_000_000_000

/**
 * PUMB returns `total_amount` as an offset from a large negative constant
 * instead of the balance itself:
 *
 * - empty moneybox (0 UAH) → `-99999999999900`
 * - 35 UAH (3500 kopecks)  → `-99999999996400`
 *
 * So the real figure in kopecks is `99999999999900 + total_amount`.
 *
 * @throws BadRequestException when the moneybox is not ACTIVE.
 */
export const adaptPumbBalance = (payload: PumbRawResponse): UnifiedBankBalance => {
  if (payload.status !== 'ACTIVE') throw new BadRequestException(ERROR.TERMINAL.INACTIVE)

  const rawAmount = payload.total_amount ?? 0
  const actualBalance =
    rawAmount <= PUMB_OFFSET_THRESHOLD ? PUMB_EMPTY_BALANCE_OFFSET + rawAmount : rawAmount

  return {
    actualBalance,
    goal: payload.amount,
    status: payload.status
  }
}

/**
 * PrivatBank reports balances as decimal strings ("100.00"), so they are scaled
 * to kopecks here.
 *
 * @throws BadRequestException when the envelope is closed or the number is unparseable.
 */
export const adaptPrivatBalance = (payload: PrivatRawResponse): UnifiedBankBalance => {
  const data = payload.data

  if (data.active === false) throw new BadRequestException(ERROR.TERMINAL.INACTIVE)

  const actualBalance = Math.round(parseFloat(data.availableBalance || '0') * 100)
  if (isNaN(actualBalance)) throw new BadRequestException(ERROR.SCRAPER.INVALID_BALANCE_FORMAT)

  const goal = data.goalAmount ? Math.round(parseFloat(data.goalAmount) * 100) : undefined

  return {
    actualBalance,
    goal,
    status: data.active ? 'ACTIVE' : 'UNKNOWN'
  }
}

/**
 * Monobank already reports kopecks.
 *
 * `closed` is what says the jar is finished, and it used to be ignored: this
 * returned a hardcoded `'ACTIVE'` on the reasoning that a jar which answered at
 * all is live. It is not — Monobank keeps answering for a closed jar and
 * reports `closed: true` in the same body. The field was declared on
 * `MonoRawResponse` and read by nobody, so a closed Monobank jar was scraped
 * forever and never treated as dead, while PrivatBank and PUMB both were.
 *
 * @throws BadRequestException when the jar is closed.
 */
export const adaptMonoBalance = (payload: MonoRawResponse): UnifiedBankBalance | null => {
  // Before the amount check: a closed jar is closed whether or not it still
  // reports a balance, and `null` here means "nothing to read", which would
  // send the scraper round again rather than retiring the terminal.
  if (payload.closed === true) throw new BadRequestException(ERROR.TERMINAL.INACTIVE)

  if (typeof payload.amount !== 'number') return null

  return {
    actualBalance: payload.amount,
    goal: typeof payload.goal === 'number' ? payload.goal : undefined,
    status: 'ACTIVE'
  }
}

/**
 * Digs `refEnv` out of a PrivatBank ZipLink response.
 *
 * `data.value` arrives in one of three shapes, and all three are handled by
 * parsing rather than by string surgery:
 *
 *   1. a JSON string whose `payload` is itself a JSON string  (double-encoded)
 *   2. a JSON string whose `payload` is a plain object
 *   3. an object already
 *
 * Returns `null` rather than throwing, so the caller decides which domain error
 * to raise.
 */
export const extractPrivatRefEnv = (payload: unknown): string | null => {
  const value = (payload as { data?: { value?: unknown } })?.data?.value

  try {
    const outer = typeof value === 'string' ? JSON.parse(value) : value
    const inner = typeof outer?.payload === 'string' ? JSON.parse(outer.payload) : outer?.payload

    return inner?.refEnv ?? null
  } catch {
    return null
  }
}
