import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import { errorCodeOf } from './error-code.util'

describe('errorCodeOf', () => {
  it('reads the code out of a thrown ERROR constant', () => {
    expect(errorCodeOf(new BadRequestException(ERROR.TERMINAL.INACTIVE))).toBe(
      ERROR.TERMINAL.INACTIVE.code
    )
    expect(errorCodeOf(new NotFoundException(ERROR.TERMINAL.NOT_FOUND))).toBe(
      ERROR.TERMINAL.NOT_FOUND.code
    )
  })

  it('reads it through the `details` spread some throw sites add', () => {
    const error = new BadRequestException({ ...ERROR.SALE.PARALLEL_LIMIT_REACHED, details: 'x' })

    expect(errorCodeOf(error)).toBe(ERROR.SALE.PARALLEL_LIMIT_REACHED.code)
  })

  /**
   * The distinction the scraper depends on. All three are 400s; only INACTIVE
   * means "stop polling this terminal for good", so branching on the status
   * would treat a transient parse failure as a dead jar.
   */
  it('tells apart failures that share a status', () => {
    const inactive = errorCodeOf(new BadRequestException(ERROR.TERMINAL.INACTIVE))
    const badUrl = errorCodeOf(new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL))
    const badFormat = errorCodeOf(new BadRequestException(ERROR.SCRAPER.INVALID_BALANCE_FORMAT))

    expect(new Set([inactive, badUrl, badFormat]).size).toBe(3)
  })

  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['an exception with a bare string body', new HttpException('boom', 400)]
  ])('returns undefined for %s', (_label, value) => {
    expect(errorCodeOf(value)).toBeUndefined()
  })
})
