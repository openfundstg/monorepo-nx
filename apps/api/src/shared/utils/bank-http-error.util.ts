import { ERROR } from '@transacto/contracts'
import { HttpException } from '@nestjs/common'
import { isAxiosError } from 'axios'

/**
 * Maps a failed bank request onto an `HttpException` that keeps the bank's status.
 *
 * **The status is load-bearing, not decoration.** `ScraperExecutionService`
 * reads it back off the exception to decide what happens next:
 *
 * | Status | Consequence |
 * |---|---|
 * | 404 | `handleDeadJar` — the terminal is disabled and pending orders are failed |
 * | 429 / 403 | randomised 30–60s backoff |
 * | 401 | logged loudly, retried in 10s |
 * | anything else | normal reschedule |
 *
 * Every bank must map through this. Monobank and PUMB each had their own copy,
 * and they disagreed: PUMB answered a 404 with `BadRequestException`, i.e. 400,
 * so `handleDeadJar` never fired for it and a deleted box was polled forever.
 */
/**
 * The same mapping, from a status number rather than a thrown axios error.
 *
 * This is the form the Isolated Scraper Worker path needs: the worker returns a
 * target's status as data, not as an exception, so there is no axios error to
 * read it off. `toBankHttpError` now delegates here so the two can never drift.
 * A missing status is a transport failure the worker could not get past, which
 * keeps the ordinary `400` reschedule path.
 */
export const bankHttpErrorForStatus = (status: number | undefined, message?: string): HttpException => {
  if (status === 404) return new HttpException(ERROR.TERMINAL.DISABLED_OR_DEAD, 404)

  if (status === 429 || status === 403) {
    return new HttpException({ ...ERROR.SCRAPER.RATE_LIMITED, details: `HTTP ${status}` }, status)
  }

  // Preserve the bank's status where there was one — 401 in particular drives
  // its own branch upstream. Without a response it is a network failure, and
  // 400 keeps it on the ordinary reschedule path.
  const details = message ?? (status ? `HTTP ${status}` : 'no response')

  return new HttpException({ ...ERROR.SCRAPER.PROCESSING_FAILED, details }, status || 400)
}

export const toBankHttpError = (error: unknown): HttpException => {
  const status = isAxiosError(error) ? error.response?.status : undefined
  const message = error instanceof Error ? error.message : String(error)

  return bankHttpErrorForStatus(status, message)
}
