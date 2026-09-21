import { AdminAmountCurrency } from '@transacto/contracts'
import { amountField, bookFilterClauses, dayRange } from 'src/modules/admin/utils'

const FIELDS = { date: 'createdAt', uah: 'fiatAmount', usdt: 'frozenUsdt' }

describe('dayRange', () => {
  /**
   * The same date in both boxes means *that day*.
   *
   * An operator picking 18 September in both means the eighteenth, not the
   * empty instant at its start. Reading `to` as midnight is the mistake this
   * exists to make impossible, and it is the kind that looks like "the filter
   * found nothing" rather than like a bug.
   */
  it('covers the whole of a single day', () => {
    const range = dayRange('2026-09-18', '2026-09-18')

    expect(range?.$gte).toEqual(new Date(2026, 8, 18, 0, 0, 0, 0))
    expect(range?.$lte).toEqual(new Date(2026, 8, 18, 23, 59, 59, 999))
  })

  it('takes one bound without the other', () => {
    expect(dayRange('2026-09-18', undefined)?.$lte).toBeUndefined()
    expect(dayRange(undefined, '2026-09-18')?.$gte).toBeUndefined()
  })

  /** Nothing asked is not the same as a range matching nothing. */
  it('is absent when neither bound was given', () => {
    expect(dayRange(undefined, undefined)).toBeNull()
  })
})

/**
 * Which figure a range applies to.
 *
 * Every row carries two — a hryvnia amount and a USDT one — and asking about
 * the wrong one does not fail, it answers a different question. "Sales over
 * ₴5 000" and "sales staking over 5 000 cents" are both plausible and only one
 * was asked.
 */
describe('amountField', () => {
  it('reads hryvnia by default', () => {
    expect(amountField(undefined, FIELDS)).toBe('fiatAmount')
    expect(amountField(AdminAmountCurrency.UAH, FIELDS)).toBe('fiatAmount')
  })

  it('reads the USDT figure when asked for it', () => {
    expect(amountField(AdminAmountCurrency.USDT, FIELDS)).toBe('frozenUsdt')
  })
})

describe('bookFilterClauses', () => {
  it('asks nothing when nothing was asked', () => {
    expect(bookFilterClauses({}, FIELDS)).toEqual({})
  })

  it('puts the range on the figure the currency names', () => {
    const clauses = bookFilterClauses(
      { currency: AdminAmountCurrency.USDT, minAmount: 1_000, maxAmount: 5_000 },
      FIELDS
    )

    expect(clauses).toEqual({ frozenUsdt: { $gte: 1_000, $lte: 5_000 } })
    expect(clauses).not.toHaveProperty('fiatAmount')
  })

  it('carries the status and the person through untouched', () => {
    expect(bookFilterClauses({ status: 'COMPLETED', telegramId: 592 }, FIELDS)).toEqual({
      status: 'COMPLETED',
      telegramId: 592
    })
  })

  /**
   * One bound is a filter, not half of one.
   *
   * "Everything over ₴5 000" is the commonest thing anybody asks a book, and
   * requiring both bounds would make it two steps.
   */
  it('accepts a lower bound alone', () => {
    expect(bookFilterClauses({ minAmount: 500_000 }, FIELDS)).toEqual({
      fiatAmount: { $gte: 500_000 }
    })
  })
})
