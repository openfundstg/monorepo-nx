import { HttpException } from '@nestjs/common'

/**
 * The `ERROR` code carried inside a thrown HTTP exception, if it has one.
 *
 * Every domain failure is thrown as an `ERROR` constant — `{ code, message }` —
 * so the code is the reliable way to tell two failures apart when they share a
 * status. `ERROR.TERMINAL.INACTIVE`, `ERROR.TERMINAL.INVALID_CRED_URL` and
 * `ERROR.SCRAPER.INVALID_BALANCE_FORMAT` are all 400s that mean entirely
 * different things, and only the first one means "stop scraping this forever".
 *
 * Returns `undefined` rather than throwing for anything that is not a NestJS
 * exception or carries no code, so a caller can branch on it directly.
 */
export const errorCodeOf = (error: unknown): number | undefined => {
  if (!(error instanceof HttpException)) return undefined

  const body = error.getResponse()
  if (typeof body !== 'object' || body === null) return undefined

  const code = (body as { code?: unknown }).code

  return typeof code === 'number' ? code : undefined
}
