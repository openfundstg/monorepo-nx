import { isAxiosError } from 'axios'

/**
 * A failure, reduced to the parts worth logging.
 *
 * **Never hand a raw `AxiosError` to a logger.** Its `config` carries the
 * request headers, and for every Transacto call that includes `X-API-TOKEN` —
 * so a single upstream 502 printed a trader's live API credential in plaintext,
 * on a path that runs every minute. That token lists terminals, executes
 * orders, creates credentials and disables them; a log aggregator holding it is
 * a compromise waiting to be noticed.
 *
 * What comes back is what an operator actually needs to act on: which call
 * failed, how, and with what status. Anything not on that list is deliberately
 * dropped rather than filtered, because a filter has to be kept in step with
 * whatever axios adds next and this does not.
 *
 * A non-HTTP failure degrades to its message; an unrecognised throw to its
 * string form. Never throws itself — a logging helper that crashes turns an
 * incident into a worse one.
 */
export const describeError = (error: unknown): string => {
  if (isAxiosError(error)) {
    const method = error.config?.method?.toUpperCase() ?? '?'
    // `url` is the path as configured; the base URL is not secret but is noise.
    const url = error.config?.url ?? '?'
    const status = error.response?.status ?? 'no response'

    return `${method} ${url} → ${status} (${error.code ?? 'no code'}): ${error.message}`
  }

  if (error instanceof Error) return error.message

  return String(error)
}

/** The same, for a batch — one line per failure, numbered as they were tried. */
export const describeErrors = (errors: readonly unknown[]): string =>
  errors.map((error, index) => `[${index}] ${describeError(error)}`).join('; ')
