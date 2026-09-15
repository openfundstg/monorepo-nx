import type { Order } from 'src/modules/repositories/order-db/schemas'
import { MatchResultStatus, SubsetSumMatcherService } from './subset-sum-matcher.service'

const order = (orderId: number, amount: number): Order => ({ orderId, amount }) as Order

const evaluate = (orders: Order[], delta: number) =>
  SubsetSumMatcherService.evaluateDelta(orders, delta)

/**
 * `environments` is `process.env`, read at call time. These tests set it to the
 * deployed configuration — fuzzy matching ON with a 5 UAH tolerance — because
 * with it off the interesting assertions below pass for the wrong reason.
 */
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env['FUZZY_MATCHING_ENABLED'] = 'true'
  process.env['FUZZY_MATCHING_TOLERANCE_UAH'] = '5'
})

afterAll(() => {
  process.env = originalEnv
})

describe('SubsetSumMatcherService.evaluateDelta', () => {
  it('is idle when nothing moved', () => {
    expect(evaluate([order(1, 9600)], 0)).toEqual({ status: MatchResultStatus.IDLE })
  })

  it('matches a single order exactly', () => {
    const result = evaluate([order(1, 9600)], 9600)

    expect(result.status).toBe(MatchResultStatus.PERFECT_MATCH)
  })

  it('matches a combination of orders exactly', () => {
    const result = evaluate([order(1, 4600), order(2, 5000)], 9600)

    expect(result.status).toBe(MatchResultStatus.PERFECT_MATCH)
  })

  it('reports ambiguity when several combinations fit', () => {
    const result = evaluate([order(1, 5000), order(2, 5000)], 5000)

    expect(result).toMatchObject({ status: MatchResultStatus.AMBIGUOUS, combinationsCount: 2 })
  })

  describe('a part-payment must never execute the order', () => {
    // The incident: a 96.00 UAH order, a 50.00 UAH deposit. The order was
    // executed anyway and the terminal was then disabled for fraud.
    const PENDING = [order(1381799, 9600)]

    it('leaves a 50 UAH deposit against a 96 UAH order unrecognized', () => {
      const result = evaluate(PENDING, 5000)

      expect(result).toEqual({ status: MatchResultStatus.UNRECOGNIZED, amount: 5000 })
    })

    it('still refuses it after an unresolved alert exists for that same deposit', () => {
      // This is what actually broke. The unmatched 5000 raised an alert; the
      // baseline does not advance for an unresolved alert, so that money is
      // still inside the next delta. Re-adding the alert's amount produced a
      // phantom 10000, which is within the 5 UAH fuzzy tolerance of 9600.
      const result = evaluate(PENDING, 5000)

      expect(result.status).not.toBe(MatchResultStatus.FUZZY_MATCH)
      expect(result.status).not.toBe(MatchResultStatus.PERFECT_MATCH)
    })

    it('matches only once the rest of the money actually arrives', () => {
      // Second deposit of 46.00 brings the balance to 96.00; the delta is
      // measured from the same unmoved baseline, so it is already 9600.
      const result = evaluate(PENDING, 9600)

      expect(result.status).toBe(MatchResultStatus.PERFECT_MATCH)
    })
  })

  describe('fuzzy matching', () => {
    it('absorbs a small shortfall within tolerance', () => {
      // 5 UAH tolerance: 9600 against a 9550 delta is a fee, not a part-payment
      const result = evaluate([order(1, 9600)], 9550)

      expect(result).toMatchObject({ status: MatchResultStatus.FUZZY_MATCH, amount: 9550 })
    })

    it('refuses a shortfall beyond tolerance', () => {
      const result = evaluate([order(1, 9600)], 9000)

      expect(result.status).toBe(MatchResultStatus.UNRECOGNIZED)
    })

    it('never matches an empty subset', () => {
      // A delta smaller than the tolerance must not match "no orders at all"
      const result = evaluate([order(1, 9600)], 100)

      expect(result.status).toBe(MatchResultStatus.UNRECOGNIZED)
    })

    it('is skipped entirely when disabled', () => {
      process.env['FUZZY_MATCHING_ENABLED'] = 'false'

      expect(evaluate([order(1, 9600)], 9550).status).toBe(MatchResultStatus.UNRECOGNIZED)
    })
  })
})
