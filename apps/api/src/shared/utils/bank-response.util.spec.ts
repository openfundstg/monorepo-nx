import { BadRequestException } from '@nestjs/common'
import {
  adaptMonoBalance,
  adaptPrivatBalance,
  adaptPumbBalance,
  extractPrivatRefEnv
} from 'src/shared/utils/bank-response.util'

describe('adaptPumbBalance', () => {
  it('decodes the negative-offset encoding into kopecks', () => {
    // PUMB reports 35 UAH as -99999999996400
    expect(adaptPumbBalance({ status: 'ACTIVE', total_amount: -99_999_999_996_400 })).toEqual({
      actualBalance: 3500,
      goal: undefined,
      status: 'ACTIVE'
    })
  })

  it('decodes an empty moneybox as zero', () => {
    expect(
      adaptPumbBalance({ status: 'ACTIVE', total_amount: -99_999_999_999_900 }).actualBalance
    ).toBe(0)
  })

  it('passes through a plain positive amount untouched', () => {
    expect(adaptPumbBalance({ status: 'ACTIVE', total_amount: 3500 }).actualBalance).toBe(3500)
  })

  it('treats a missing amount as zero', () => {
    expect(adaptPumbBalance({ status: 'ACTIVE' }).actualBalance).toBe(0)
  })

  it('carries the goal through', () => {
    expect(adaptPumbBalance({ status: 'ACTIVE', total_amount: 100, amount: 50_000 }).goal).toBe(
      50_000
    )
  })

  it('rejects a moneybox that is not ACTIVE', () => {
    expect(() => adaptPumbBalance({ status: 'CLOSED', total_amount: 100 })).toThrow(
      BadRequestException
    )
  })
})

describe('adaptPrivatBalance', () => {
  it('scales the decimal string to kopecks', () => {
    expect(adaptPrivatBalance({ data: { availableBalance: '100.00', active: true } })).toEqual({
      actualBalance: 10_000,
      goal: undefined,
      status: 'ACTIVE'
    })
  })

  it('rounds rather than truncates', () => {
    expect(adaptPrivatBalance({ data: { availableBalance: '0.015' } }).actualBalance).toBe(2)
  })

  it('defaults a missing balance to zero', () => {
    expect(adaptPrivatBalance({ data: {} }).actualBalance).toBe(0)
  })

  it('scales the goal too', () => {
    expect(adaptPrivatBalance({ data: { goalAmount: '250.50' } }).goal).toBe(25_050)
  })

  it('rejects a closed envelope', () => {
    expect(() => adaptPrivatBalance({ data: { active: false } })).toThrow(BadRequestException)
  })

  it('rejects an unparseable balance', () => {
    expect(() => adaptPrivatBalance({ data: { availableBalance: 'not-a-number' } })).toThrow(
      BadRequestException
    )
  })
})

describe('adaptMonoBalance', () => {
  it('takes the kopeck amount as-is', () => {
    expect(adaptMonoBalance({ amount: 4200, goal: 100_000 })).toEqual({
      actualBalance: 4200,
      goal: 100_000,
      status: 'ACTIVE'
    })
  })

  it('returns null when the payload carries no numeric amount', () => {
    expect(adaptMonoBalance({})).toBeNull()
    expect(adaptMonoBalance({ amount: '4200' as unknown as number })).toBeNull()
  })

  /**
   * The field was declared and read by nobody: this returned a hardcoded
   * `'ACTIVE'`, so a closed Monobank jar was scraped forever and never retired,
   * while PrivatBank and PUMB both were. A jar nobody is finished with is
   * exactly where a late payment on an expired order lands.
   */
  it('refuses a closed jar', () => {
    expect(() => adaptMonoBalance({ amount: 4200, goal: 100_000, closed: true })).toThrow(
      BadRequestException
    )
  })

  /** Closed is closed, whatever balance it still reports — including none. */
  it('refuses a closed jar before it looks at the amount', () => {
    expect(() => adaptMonoBalance({ closed: true })).toThrow(BadRequestException)
  })

  it.each([false, undefined])('reads a jar normally when closed is %p', (closed) => {
    expect(adaptMonoBalance({ amount: 4200, closed })?.actualBalance).toBe(4200)
  })

  it('drops a non-numeric goal', () => {
    expect(adaptMonoBalance({ amount: 1, goal: null as unknown as number })?.goal).toBeUndefined()
  })
})

describe('extractPrivatRefEnv', () => {
  it('reads refEnv out of the escaped-JSON-in-JSON form', () => {
    const value = `{"payload":"{\\"refEnv\\":\\"ENV-123\\"}"}`
    expect(extractPrivatRefEnv({ data: { value } })).toBe('ENV-123')
  })

  it('falls back to parsing an unescaped JSON string', () => {
    const value = JSON.stringify({ payload: { refEnv: 'ENV-456' } })
    expect(extractPrivatRefEnv({ data: { value } })).toBe('ENV-456')
  })

  it('reads refEnv when the value already arrived as an object', () => {
    expect(extractPrivatRefEnv({ data: { value: { payload: { refEnv: 'ENV-789' } } } })).toBe(
      'ENV-789'
    )
  })

  it('returns null instead of throwing on junk', () => {
    expect(extractPrivatRefEnv({ data: { value: 'not json at all' } })).toBeNull()
    expect(extractPrivatRefEnv({})).toBeNull()
    expect(extractPrivatRefEnv(undefined)).toBeNull()
  })
})
