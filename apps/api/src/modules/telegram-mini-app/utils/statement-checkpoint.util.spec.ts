import { SaleCardOrderState } from '@transacto/contracts'
import { statementCorrection } from './statement-checkpoint.util'

const HOUR = 60 * 60 * 1000
const GRACE = 3 * HOUR

/** Structure only: every figure below is invented. */
const order = (overrides: Record<string, unknown> = {}) =>
  ({
    orderId: 1,
    amount: 100_000,
    state: SaleCardOrderState.CONFIRMED,
    arrivedAt: new Date('2026-09-17T10:00:00Z'),
    confirmDeadlineAt: new Date('2026-09-17T10:06:00Z'),
    answeredAt: new Date('2026-09-17T10:04:00Z'),
    statements: [],
    ...overrides
  }) as never

const statement = (movements: { at: string; amountKopecks: number }[]) => ({
  periodFrom: new Date('2026-09-01T00:00:00Z'),
  periodTo: new Date('2026-09-30T23:59:59Z'),
  ownerName: 'Петренко Роман Іванович',
  cardTail: '1111',
  unreadableRows: 0,
  creditsReconciled: true,
  movements: movements.map((movement) => ({
    at: new Date(movement.at),
    amountKopecks: movement.amountKopecks,
    currencyCode: '980'
  }))
}) as never

describe('statementCorrection', () => {
  it('finds nothing to correct when nobody claimed a shortfall', () => {
    const result = statementCorrection(
      [order()],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 100_000 }]),
      GRACE
    )

    expect(result).toEqual({ correctionKopecks: 0, unsettled: [] })
  })

  /** The seller told the truth: ₴995 claimed, ₴995 on the statement. */
  it('confirms an honest shortfall and changes nothing', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 99_500 }]),
      GRACE
    )

    expect(result.correctionKopecks).toBe(0)
  })

  /**
   * The claim this whole mechanism exists for: ₴995 declared, ₴1 000 received.
   * The ₴5 goes back onto the target and comes out of the held remainder.
   */
  it('corrects a shortfall the bank does not show', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 100_000 }]),
      GRACE
    )

    expect(result.correctionKopecks).toBe(500)
  })

  /**
   * One document settles every claim inside its period, including orders it was
   * never uploaded for — that is what makes it a checkpoint.
   */
  it('settles every claim in the period, not only the newest', () => {
    const result = statementCorrection(
      [
        order({ orderId: 1, declaredAmount: 99_500 }),
        order({
          orderId: 2,
          declaredAmount: 98_000,
          arrivedAt: new Date('2026-09-17T12:00:00Z'),
          confirmDeadlineAt: new Date('2026-09-17T12:06:00Z')
        })
      ],
      statement([
        { at: '2026-09-17T10:03:00Z', amountKopecks: 100_000 },
        { at: '2026-09-17T12:02:00Z', amountKopecks: 99_000 }
      ]),
      GRACE
    )

    expect(result.correctionKopecks).toBe(500 + 1_000)
  })

  /**
   * Summing the window buys split payments and gives up the old "two credits
   * mean I cannot tell" guard, so an unrelated transfer now adds to the total.
   * The cap is what keeps that harmless — a correction can bring an order up to
   * what Transacto routed and no further.
   */
  it('never corrects an order past what it was for', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 100_000 },
        // Somebody else's money, on the same card, in the same six minutes.
        { at: '2026-09-17T10:04:00Z', amountKopecks: 500_000 }
      ]),
      GRACE
    )

    // Up to the order's ₴1 000, and not a kopeck of the stranger's ₴5 000.
    expect(result.correctionKopecks).toBe(500)
  })

  /**
   * **The money can land before this process hears of the order.**
   *
   * Transacto creates an order and routes a payer to it; we learn of it from a
   * webhook, or — when that does not land — from a sweep thirty seconds wide.
   * The payer is paying on Transacto's clock the whole time, so a window that
   * opened at our own `arrivedAt` excluded credits that were plainly this
   * order's. This is the production case, to the second: the credit at 18:14:20
   * and the order recorded at 18:14:31.
   */
  it('finds a credit that landed before the order was recorded', () => {
    const result = statementCorrection(
      [
        order({
          declaredAmount: 29_900,
          arrivedAt: new Date('2026-09-18T15:14:31Z'),
          confirmDeadlineAt: new Date('2026-09-18T15:20:31Z')
        })
      ],
      statement([{ at: '2026-09-18T15:14:20Z', amountKopecks: 30_000 }]),
      GRACE
    )

    expect(result.correctionKopecks).toBe(100)
    expect(result.unsettled).toEqual([])
  })

  /** …but not one from long enough before to belong to something else. */
  it('still ignores a credit from well before the order existed', () => {
    const result = statementCorrection(
      [
        order({
          declaredAmount: 29_900,
          arrivedAt: new Date('2026-09-18T15:14:31Z'),
          confirmDeadlineAt: new Date('2026-09-18T15:20:31Z')
        })
      ],
      statement([{ at: '2026-09-18T15:05:00Z', amountKopecks: 30_000 }]),
      GRACE
    )

    expect(result.unsettled).toEqual([{ orderId: 1, declaredKopecks: 29_900 }])
  })

  /** Understating your own receipts costs only yourself; nothing is taken back. */
  it('never corrects downwards', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 100_000 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 90_000 }]),
      GRACE
    )

    expect(result.correctionKopecks).toBe(0)
  })

  /**
   * One Transacto order can be paid by several transfers, so what landed for it
   * is the total of the credits in its window — ₴400 and ₴600 against a ₴1 000
   * order is an ordinary way for it to arrive.
   */
  it('sums several transfers against one order', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 40_000 },
        { at: '2026-09-17T10:04:00Z', amountKopecks: 60_000 }
      ]),
      GRACE
    )

    // ₴1 000 arrived in two parts; the seller claimed ₴995.
    expect(result.correctionKopecks).toBe(500)
  })

  it('finds an honest split payment honest', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 40_000 },
        { at: '2026-09-17T10:04:00Z', amountKopecks: 59_500 }
      ]),
      GRACE
    )

    expect(result).toEqual({ correctionKopecks: 0, unsettled: [] })
  })

  /**
   * Worse than a shortfall, and not correctable: the seller confirmed a payment,
   * their USDT went out against it, and the bank shows nothing in the window.
   */
  it('reports a claim with no credit at all rather than correcting it', () => {
    const result = statementCorrection([order({ declaredAmount: 99_500 })], statement([]), GRACE)

    expect(result).toEqual({
      correctionKopecks: 0,
      unsettled: [{ orderId: 1, declaredKopecks: 99_500 }]
    })
  })

  /** Debits are not credits, however well the amount lines up. */
  it('ignores money leaving the account', () => {
    const result = statementCorrection(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: -100_000 }]),
      GRACE
    )

    expect(result.unsettled).toEqual([{ orderId: 1, declaredKopecks: 99_500 }])
  })

  /**
   * A claim the document does not reach is not unsettled — it is simply outside
   * this statement, and a later one may cover it.
   */
  it('passes over a claim outside the period without complaint', () => {
    const result = statementCorrection(
      [
        order({
          declaredAmount: 99_500,
          arrivedAt: new Date('2026-10-05T10:00:00Z'),
          confirmDeadlineAt: new Date('2026-10-05T10:06:00Z')
        })
      ],
      statement([]),
      GRACE
    )

    expect(result).toEqual({ correctionKopecks: 0, unsettled: [] })
  })
})
