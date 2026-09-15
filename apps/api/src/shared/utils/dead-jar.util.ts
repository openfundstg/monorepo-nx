import { HttpException } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { ERROR } from '@transacto/contracts'
import { errorCodeOf } from 'src/shared/utils/error-code.util'

/** What a bank answers with when the pot behind a terminal is gone for good. */
const GONE = 404

/**
 * Whether this failure means the jar, envelope or moneybox is finished.
 *
 * Two signals, and they mean the same thing: a `404` says the bank no longer
 * serves this target at all, and `ERROR.TERMINAL.INACTIVE` says it answered and
 * reported the pot closed — PrivatBank's `active: false`, PUMB's non-`ACTIVE`
 * status, Monobank's `closed`.
 *
 * Shared because two callers now decide it. The scrape loop retires a terminal
 * on it, and the reconciliation sweep releases a user's sale slot on it
 * — and a sweep that read "closed" differently from the loop would either free
 * a slot whose jar is still taking money, or hold one for a jar that has been
 * shut for months.
 */
export const isDeadJarError = (error: unknown): boolean => {
  const status = error instanceof HttpException
    ? error.getStatus()
    : isAxiosError(error)
      ? error.response?.status
      : undefined

  return status === GONE || errorCodeOf(error) === ERROR.TERMINAL.INACTIVE.code
}
