import { ERROR } from '@transacto/contracts'
import { HttpException } from '@nestjs/common'
import { bankHttpErrorForStatus, toBankHttpError } from 'src/shared/utils/bank-http-error.util'

/**
 * Stand-in for an axios error.
 *
 * Built on a real `Error` because that is what axios throws — `isAxiosError`
 * only checks the flag, but the message is read via `instanceof Error`.
 */
const axiosError = (status?: number, message = 'boom') =>
  Object.assign(new Error(message), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status },
  })

describe('toBankHttpError', () => {
  it('keeps 404 so a dead jar is retired rather than polled forever', () => {
    // ScraperExecutionService calls handleDeadJar on 404 and nothing else.
    // PUMB used to answer this with BadRequestException — 400 — so its dead
    // boxes were never retired.
    const result = toBankHttpError(axiosError(404))

    expect(result).toBeInstanceOf(HttpException)
    expect(result.getStatus()).toBe(404)
    expect(result.getResponse()).toEqual(ERROR.TERMINAL.DISABLED_OR_DEAD)
  })

  it.each([429, 403])('keeps %i so the caller backs off', (status) => {
    const result = toBankHttpError(axiosError(status))

    expect(result.getStatus()).toBe(status)
    expect(result.getResponse()).toMatchObject({
      code: ERROR.SCRAPER.RATE_LIMITED.code,
      details: `HTTP ${status}`,
    })
  })

  it('keeps 401, which drives its own branch upstream', () => {
    const result = toBankHttpError(axiosError(401))

    expect(result.getStatus()).toBe(401)
    expect(result.getResponse()).toMatchObject({ code: ERROR.SCRAPER.PROCESSING_FAILED.code })
  })

  it('falls back to 400 for a network failure with no response', () => {
    const result = toBankHttpError(axiosError(undefined, 'socket hang up'))

    expect(result.getStatus()).toBe(400)
    expect(result.getResponse()).toMatchObject({ details: 'socket hang up' })
  })

  it('handles a non-axios error', () => {
    const result = toBankHttpError(new Error('adapter blew up'))

    expect(result.getStatus()).toBe(400)
    expect(result.getResponse()).toMatchObject({ details: 'adapter blew up' })
  })

  it('handles something that is not an Error at all', () => {
    const result = toBankHttpError('just a string')

    expect(result.getStatus()).toBe(400)
    expect(result.getResponse()).toMatchObject({ details: 'just a string' })
  })

  it('gives Monobank and PUMB the same answer for the same failure', () => {
    // They used to have separate copies of this mapping, and they disagreed.
    const forMono = toBankHttpError(axiosError(404))
    const forPumb = toBankHttpError(axiosError(404))

    expect(forPumb.getStatus()).toBe(forMono.getStatus())
    expect(forPumb.getResponse()).toEqual(forMono.getResponse())
  })
})

/**
 * The form the scraper worker path uses: a status number, because the worker
 * returns a bank's status as data rather than throwing. It must land on exactly
 * the same `ERROR` codes as the axios path, or the two egress routes would treat
 * the same dead jar differently.
 */
describe('bankHttpErrorForStatus', () => {
  it('maps a status the same way toBankHttpError maps that status on an axios error', () => {
    for (const status of [404, 429, 403, 401]) {
      const direct = bankHttpErrorForStatus(status)
      const viaAxios = toBankHttpError(axiosError(status, `HTTP ${status}`))

      expect(direct.getStatus()).toBe(viaAxios.getStatus())
      expect(direct.getResponse()).toEqual(viaAxios.getResponse())
    }
  })

  it('treats a missing status as a 400 transport failure', () => {
    const result = bankHttpErrorForStatus(undefined)

    expect(result.getStatus()).toBe(400)
    expect(result.getResponse()).toMatchObject({ code: ERROR.SCRAPER.PROCESSING_FAILED.code })
  })

  it('keeps a non-repairable upstream status, e.g. a 500', () => {
    const result = bankHttpErrorForStatus(500)

    expect(result.getStatus()).toBe(500)
    expect(result.getResponse()).toMatchObject({ code: ERROR.SCRAPER.PROCESSING_FAILED.code })
  })
})
