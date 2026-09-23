import { SaleCardOrderState } from '@transacto/contracts'
import {
  coverageRequiredTo,
  statementCorrection,
  windowForOrder
} from './statement-checkpoint.util'

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

/**
 * The correction, with the orders already inside `receivedAmount` named.
 *
 * **Defaults to all of them, and the default is the point of the helper.**
 * Nearly every case here is about a claim that *was* credited — the seller
 * declared a figure, the order executed on it, and the document then corrects
 * it. Saying so once keeps those cases reading as they did, and leaves the
 * uncredited ones to pass `[]` and state their difference out loud.
 */
const correct = (
  orders: readonly unknown[],
  stmt: unknown,
  credited: readonly number[] = (orders as { orderId: number }[]).map((o) => o.orderId)
) => statementCorrection(orders as never, stmt as never, GRACE, credited)

describe('statementCorrection', () => {
  it('finds nothing to correct when nobody claimed a shortfall', () => {
    const result = correct(
      [order()],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 100_000 }])
    )

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })

  /** The seller told the truth: ₴995 claimed, ₴995 on the statement. */
  it('confirms an honest shortfall and changes nothing', () => {
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 99_500 }])
    )

    expect(result.correctionKopecks).toBe(0)
  })

  /**
   * The claim this whole mechanism exists for: ₴995 declared, ₴1 000 received.
   * The ₴5 goes back onto the target and comes out of the held remainder.
   */
  it('corrects a shortfall the bank does not show', () => {
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 100_000 }])
    )

    expect(result.correctionKopecks).toBe(500)
    // Both figures, kept apart: what the seller said and what the bank shows
    // are different facts, and the row they are drawn on shows both.
    expect(result.corrected).toEqual([
      { orderId: 1, declaredKopecks: 99_500, provenKopecks: 100_000 }
    ])
  })

  /**
   * **The claim is checked against the order's own figure, not against
   * itself.** A seller who wants to keep ₴5 declares ₴295 of a ₴300 order and
   * sends themselves ₴295 from another card, so the window holds a credit that
   * corroborates their claim exactly. Searching for what they said would find
   * it and agree.
   *
   * Summing and capping is what makes that useless: the payer's ₴300 is in the
   * same window, the total is ₴595, and an order can be brought up to what
   * Transacto routed and no further. The seller's own money buys them nothing.
   */
  it('still finds the order’s own payment behind a self-transfer that matches the claim', () => {
    const result = correct(
      [
        order({
          amount: 30_000,
          declaredAmount: 29_500,
          arrivedAt: new Date('2026-09-17T12:03:00Z'),
          answeredAt: new Date('2026-09-17T12:07:00Z'),
          confirmDeadlineAt: new Date('2026-09-17T12:08:00Z')
        })
      ],
      statement([
        // Their own ₴295, timed to corroborate the figure they gave.
        { at: '2026-09-17T12:04:00Z', amountKopecks: 29_500 },
        // …and the payer's ₴300, which is what actually landed for the order.
        { at: '2026-09-17T12:05:00Z', amountKopecks: 30_000 }
      ])
    )

    expect(result.correctionKopecks).toBe(500)
    expect(result.corrected).toEqual([
      { orderId: 1, declaredKopecks: 29_500, provenKopecks: 30_000 }
    ])
  })

  /**
   * **A claim nothing credited is not this document's to correct.**
   *
   * A shortfall past the allowance is not executed at all: the order is
   * disputed and `receivedAmount` holds none of it. Correcting it here would
   * add the difference to a figure that was never there, and the finding this
   * same statement produces then credits the whole order a moment later.
   *
   * Sale 13D4L8YJ, 2026-09-23: ₴101 declared of a ₴301 order, ₴200 added here
   * and ₴301 added by the settlement. The sale read ₴801 of ₴960 against ₴601
   * really received, closed on a ₴159 tail an operator transferred by hand, and
   * left its seller ₴200 short for a full stake of USDT.
   */
  it('leaves a disputed order alone, however much the document shows', () => {
    const result = correct(
      [
        order({
          amount: 30_100,
          state: SaleCardOrderState.DISPUTED,
          declaredAmount: 10_100
        })
      ],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 30_100 }]),
      []
    )

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })

  /**
   * …and it is not an unsettled claim either. A document silent about a
   * disputed order is the ordinary way a denial is upheld — nobody's USDT went
   * out against it — and reporting it raised an operator alarm about an order
   * working exactly as designed.
   */
  it('does not report a disputed order the document is silent about', () => {
    const result = correct(
      [order({ state: SaleCardOrderState.DISPUTED, declaredAmount: 10_100 })],
      statement([]),
      []
    )

    expect(result.unsettled).toEqual([])
  })

  /**
   * The two halves together, on the shape that produced the incident: one order
   * credited on the seller's short figure, one disputed and credited by
   * nothing. Only the first is this function's.
   */
  it('corrects the credited order and passes over the disputed one', () => {
    const result = correct(
      [
        order({
          orderId: 1,
          amount: 30_000,
          declaredAmount: 29_500,
          arrivedAt: new Date('2026-09-17T10:00:30Z'),
          answeredAt: new Date('2026-09-17T10:02:48Z'),
          confirmDeadlineAt: new Date('2026-09-17T10:05:30Z')
        }),
        order({
          orderId: 2,
          amount: 30_100,
          state: SaleCardOrderState.DISPUTED,
          declaredAmount: 10_100,
          arrivedAt: new Date('2026-09-17T10:05:00Z'),
          answeredAt: new Date('2026-09-17T10:09:42Z'),
          confirmDeadlineAt: new Date('2026-09-17T10:10:00Z')
        })
      ],
      statement([
        { at: '2026-09-17T10:00:44Z', amountKopecks: 30_000 },
        { at: '2026-09-17T10:05:09Z', amountKopecks: 30_100 }
      ]),
      // Order 2 executed on nobody's word, so it is in neither.
      [1]
    )

    // ₴295 already credited plus this ₴5 is ₴300; the ₴301 the settlement adds
    // brings the sale to ₴601 rather than ₴801.
    expect(result.correctionKopecks).toBe(500)
    expect(result.corrected).toEqual([
      { orderId: 1, declaredKopecks: 29_500, provenKopecks: 30_000 }
    ])
    expect(result.unsettled).toEqual([])
  })

  /**
   * One document settles every claim inside its period, including orders it was
   * never uploaded for — that is what makes it a checkpoint.
   */
  it('settles every claim in the period, not only the newest', () => {
    const result = correct(
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
      ])
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
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 100_000 },
        // Somebody else's money, on the same card, in the same six minutes.
        { at: '2026-09-17T10:04:00Z', amountKopecks: 500_000 }
      ])
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
    const result = correct(
      [
        order({
          declaredAmount: 29_900,
          arrivedAt: new Date('2026-09-18T15:14:31Z'),
          confirmDeadlineAt: new Date('2026-09-18T15:20:31Z')
        })
      ],
      statement([{ at: '2026-09-18T15:14:20Z', amountKopecks: 30_000 }])
    )

    expect(result.correctionKopecks).toBe(100)
    expect(result.unsettled).toEqual([])
  })

  /** …but not one from long enough before to belong to something else. */
  it('still ignores a credit from well before the order existed', () => {
    const result = correct(
      [
        order({
          declaredAmount: 29_900,
          arrivedAt: new Date('2026-09-18T15:14:31Z'),
          confirmDeadlineAt: new Date('2026-09-18T15:20:31Z')
        })
      ],
      statement([{ at: '2026-09-18T15:05:00Z', amountKopecks: 30_000 }])
    )

    expect(result.unsettled).toEqual([{ orderId: 1, declaredKopecks: 29_900 }])
  })

  /**
   * **A second document over the same window must not credit it again.**
   *
   * A later dispute takes a wider statement with it, and that document
   * recomputes every claim inside its period — including ones an earlier one
   * already settled. Measured against the seller's original figure every time,
   * the same ₴2 would go onto the target once per statement.
   */
  it('does not correct an order a statement already corrected', () => {
    const result = correct(
      [order({ declaredAmount: 29_800, provenAmount: 30_000 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 30_000 }])
    )

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })

  /** …and a stronger document adds only what it proves beyond the last one. */
  it('adds only the difference when a later statement shows more', () => {
    const result = correct(
      [order({ declaredAmount: 29_800, provenAmount: 29_900 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 30_000 }])
    )

    expect(result.correctionKopecks).toBe(100)
    // The seller's own figure on the entry, not our last arithmetic: the
    // sentence is about what they told us.
    expect(result.corrected).toEqual([
      { orderId: 1, declaredKopecks: 29_800, provenKopecks: 30_000 }
    ])
  })

  /** Understating your own receipts costs only yourself; nothing is taken back. */
  it('never corrects downwards', () => {
    const result = correct(
      [order({ declaredAmount: 100_000 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: 90_000 }])
    )

    expect(result.correctionKopecks).toBe(0)
  })

  /**
   * One Transacto order can be paid by several transfers, so what landed for it
   * is the total of the credits in its window — ₴400 and ₴600 against a ₴1 000
   * order is an ordinary way for it to arrive.
   */
  it('sums several transfers against one order', () => {
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 40_000 },
        { at: '2026-09-17T10:04:00Z', amountKopecks: 60_000 }
      ])
    )

    // ₴1 000 arrived in two parts; the seller claimed ₴995.
    expect(result.correctionKopecks).toBe(500)
  })

  it('finds an honest split payment honest', () => {
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([
        { at: '2026-09-17T10:02:00Z', amountKopecks: 40_000 },
        { at: '2026-09-17T10:04:00Z', amountKopecks: 59_500 }
      ])
    )

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })

  /**
   * Worse than a shortfall, and not correctable: the seller confirmed a payment,
   * their USDT went out against it, and the bank shows nothing in the window.
   */
  it('reports a claim with no credit at all rather than correcting it', () => {
    const result = correct([order({ declaredAmount: 99_500 })], statement([]))

    expect(result).toEqual({
      correctionKopecks: 0,
      corrected: [],
      unsettled: [{ orderId: 1, declaredKopecks: 99_500 }]
    })
  })

  /** Debits are not credits, however well the amount lines up. */
  it('ignores money leaving the account', () => {
    const result = correct(
      [order({ declaredAmount: 99_500 })],
      statement([{ at: '2026-09-17T10:03:00Z', amountKopecks: -100_000 }])
    )

    expect(result.unsettled).toEqual([{ orderId: 1, declaredKopecks: 99_500 }])
  })

  /**
   * A claim the document does not reach is not unsettled — it is simply outside
   * this statement, and a later one may cover it.
   */
  it('passes over a claim outside the period without complaint', () => {
    const result = correct(
      [
        order({
          declaredAmount: 99_500,
          arrivedAt: new Date('2026-10-05T10:00:00Z'),
          confirmDeadlineAt: new Date('2026-10-05T10:06:00Z')
        })
      ],
      statement([])
    )

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })

  /**
   * **Orders arrive closer together than the discovery allowance is wide, and
   * the allowance used to be the whole boundary between two windows.**
   *
   * So each window opened two minutes before its order was recorded — which, at
   * 90 and 60 seconds apart, is *before the previous payer had finished
   * paying*. The whole partition sat one order too early: the first order's
   * credit was attributed correctly, the second's window held nothing, and the
   * third's held two credits and so matched neither.
   *
   * The spacing and the bank's minute-resolution clock below are the production
   * case of 2026-09-20, with every figure invented. The statement showed all
   * three payments plainly, and under the old bounds this returned two unsettled
   * claims — telling an operator that a seller had been paid nothing for money
   * printed on the document in front of them.
   */
  it('gives each of three orders a minute apart its own credit', () => {
    const orders = [
      order({
        orderId: 1,
        declaredAmount: 29_600,
        amount: 30_000,
        arrivedAt: new Date('2026-09-17T10:00:30Z'),
        answeredAt: new Date('2026-09-17T10:01:27Z'),
        confirmDeadlineAt: new Date('2026-09-17T10:05:30Z')
      }),
      order({
        orderId: 2,
        declaredAmount: 29_600,
        amount: 30_000,
        arrivedAt: new Date('2026-09-17T10:02:00Z'),
        answeredAt: new Date('2026-09-17T10:02:42Z'),
        confirmDeadlineAt: new Date('2026-09-17T10:07:00Z')
      }),
      order({
        orderId: 3,
        declaredAmount: 29_600,
        amount: 30_000,
        arrivedAt: new Date('2026-09-17T10:03:00Z'),
        answeredAt: new Date('2026-09-17T10:03:55Z'),
        confirmDeadlineAt: new Date('2026-09-17T10:08:00Z')
      })
    ]

    // PrivatBank prints `HH:MM` and nothing finer, so every credit is on a
    // whole minute — which is what made the old bounds miss by so little.
    const result = correct(
      orders,
      statement([
        { at: '2026-09-17T10:00:00Z', amountKopecks: 30_000 },
        { at: '2026-09-17T10:02:00Z', amountKopecks: 30_000 },
        { at: '2026-09-17T10:03:00Z', amountKopecks: 30_000 }
      ])
    )

    // ₴4 owed on each of the three, and nothing for a person to look at.
    // Named one by one as well as summed: the sum moves the sale's total, and
    // these are what the seller's three rows and three timeline entries say.
    expect(result).toEqual({
      correctionKopecks: 1_200,
      corrected: [
        { orderId: 1, declaredKopecks: 29_600, provenKopecks: 30_000 },
        { orderId: 2, declaredKopecks: 29_600, provenKopecks: 30_000 },
        { orderId: 3, declaredKopecks: 29_600, provenKopecks: 30_000 }
      ],
      unsettled: []
    })
  })
})

/**
 * Where one order's window ends and the next one's begins.
 *
 * **The two edges must come from one definition.** A gap loses a credit that
 * belongs to somebody; an overlap attributes one credit to two orders, and the
 * dispute check searches a window for an order's own amount — two orders of a
 * sale are routinely the same size, so an overlap reports a payment as arrived
 * that never did. That is the dangerous direction.
 */
describe('windowForOrder — the boundary between two orders', () => {
  const ORDERS = [
    order({
      orderId: 1,
      arrivedAt: new Date('2026-09-17T10:00:30Z'),
      answeredAt: new Date('2026-09-17T10:01:27Z'),
      confirmDeadlineAt: new Date('2026-09-17T10:05:30Z')
    }),
    order({
      orderId: 2,
      arrivedAt: new Date('2026-09-17T10:02:00Z'),
      answeredAt: new Date('2026-09-17T10:02:42Z'),
      confirmDeadlineAt: new Date('2026-09-17T10:07:00Z')
    }),
    order({
      orderId: 3,
      arrivedAt: new Date('2026-09-17T10:03:00Z'),
      answeredAt: new Date('2026-09-17T10:03:55Z'),
      confirmDeadlineAt: new Date('2026-09-17T10:08:00Z')
    })
  ]

  const windowOf = (orderId: number) => windowForOrder(ORDERS, orderId, GRACE)

  it('leaves no gap and no overlap between consecutive windows', () => {
    const [first, second, third] = [windowOf(1), windowOf(2), windowOf(3)]

    expect(second?.from.getTime()).toBe((first?.to.getTime() ?? 0) + 1)
    expect(third?.from.getTime()).toBe((second?.to.getTime() ?? 0) + 1)
  })

  /**
   * `max_open_orders: 1`, so order two cannot have been routed until order one
   * was answered — and `answeredAt` is a moment this process wrote down rather
   * than an allowance somebody guessed at.
   */
  it('opens a window no earlier than the previous order was answered', () => {
    expect(windowOf(2)?.from.toISOString()).toBe('2026-09-17T10:01:27.000Z')
  })

  /**
   * And no earlier than the discovery allowance, which is the *other* lower
   * bound and wins whenever the orders are far enough apart. Taking
   * `answeredAt` alone here would open this window two hours early and hand it
   * every late credit belonging to the order before.
   */
  it('still holds to the discovery allowance for orders far apart', () => {
    const distant = [
      order({ orderId: 1, answeredAt: new Date('2026-09-17T10:04:00Z') }),
      order({
        orderId: 2,
        arrivedAt: new Date('2026-09-17T12:00:00Z'),
        confirmDeadlineAt: new Date('2026-09-17T12:06:00Z')
      })
    ]

    expect(windowForOrder(distant, 2, GRACE)?.from.toISOString()).toBe('2026-09-17T11:58:00.000Z')
  })

  /**
   * An order nobody answered — cancelled, expired — has no timestamp to bound
   * the next one with, so the allowance stands alone rather than the boundary
   * collapsing to the epoch.
   */
  it('falls back to the allowance when the previous order was never answered', () => {
    const unanswered = [
      order({ orderId: 1, answeredAt: null, arrivedAt: new Date('2026-09-17T10:00:30Z') }),
      order({
        orderId: 2,
        arrivedAt: new Date('2026-09-17T10:02:00Z'),
        confirmDeadlineAt: new Date('2026-09-17T10:07:00Z')
      })
    ]

    expect(windowForOrder(unanswered, 2, GRACE)?.from.toISOString()).toBe(
      '2026-09-17T10:00:00.000Z'
    )
  })

  it('has no window for an order the sale does not carry', () => {
    expect(windowForOrder(ORDERS, 999, GRACE)).toBeNull()
  })
})

/**
 * How much of a window a document is actually required to account for.
 *
 * **The bug: it was the whole window, and the window ends in the future.** Its
 * upper edge is the payment deadline plus three hours of grace for a bank
 * posting late, and a seller is asked for a statement the moment the deadline
 * passes — so they were being asked to produce a document covering hours that
 * had not happened.
 *
 * Harmless for most of the day, because a bank issues whole days and a same-day
 * statement runs to 23:59:59, which is past almost any window's edge. Fatal
 * once that edge crossed midnight: an order whose deadline fell after 21:00
 * Kyiv could not be answered by any statement produced that day. Confirmed on a
 * real one — it covered its whole day, every row read, credits reconciled, and
 * it was refused as too short.
 */
describe('coverageRequiredTo', () => {
  const WINDOW = { to: new Date('2026-09-18T22:05:00Z') }

  it('asks only for what has happened when the window is still open', () => {
    const now = new Date('2026-09-18T19:17:00Z')

    expect(coverageRequiredTo(WINDOW, now)).toEqual(now)
  })

  it('asks for the whole window once it has closed', () => {
    expect(coverageRequiredTo(WINDOW, new Date('2026-09-19T08:00:00Z'))).toEqual(WINDOW.to)
  })

  /** Never further than the window itself: a later statement is not asked for more. */
  it('never asks for more than the window, however late the document arrives', () => {
    const now = new Date('2026-09-25T08:00:00Z')

    expect(coverageRequiredTo(WINDOW, now).getTime()).toBeLessThanOrEqual(WINDOW.to.getTime())
  })

  /** And never for more than the present, however far ahead the window ends. */
  it('never asks for the future', () => {
    const now = new Date('2026-09-18T19:17:00Z')

    expect(coverageRequiredTo(WINDOW, now).getTime()).toBeLessThanOrEqual(now.getTime())
  })
})

/**
 * A statement that stops inside a claim's window.
 *
 * **The everyday case, and it used to be the broken one.** A window runs to the
 * payment deadline plus three hours of grace; a bank issues whole days; so a
 * seller who confirms an evening order and pulls a statement minutes later
 * hands over a document that stops hours before the window does. Every such
 * order was skipped outright — and, because the sale stamped a checkpoint
 * anyway, the hold that was the only other thing watching the claim was
 * dropped with it. Sale 73GFZ7F9: ₴447 shown by the bank, ₴443 declared, ₴4
 * neither corrected nor held.
 */
describe('statementCorrection over a window the document only partly covers', () => {
  /** Ends 17:00; the order's window runs to 13:06 the day it opened. */
  const stopsEarly = (movements: { at: string; amountKopecks: number }[]) =>
    ({
      ...(statement(movements) as unknown as Record<string, unknown>),
      periodFrom: new Date('2026-09-17T00:00:00Z'),
      periodTo: new Date('2026-09-17T11:00:00Z')
    }) as never

  it('corrects from the part it can see', () => {
    const result = correct(
      [order({ declaredAmount: 99_600 })],
      stopsEarly([{ at: '2026-09-17T10:01:00Z', amountKopecks: 100_000 }])
    )

    expect(result.correctionKopecks).toBe(400)
    expect(result.corrected).toEqual([
      { orderId: 1, declaredKopecks: 99_600, provenKopecks: 100_000 }
    ])
  })

  /**
   * **A sum over part of a window is a lower bound**, and the figure is capped
   * at the order's own amount — so a partial document can only under-correct.
   * It can never invent hryvnia, which is the only direction that would matter.
   */
  it('never corrects past the order, whatever else landed on the card', () => {
    const result = correct(
      [order({ declaredAmount: 99_600 })],
      stopsEarly([
        { at: '2026-09-17T10:01:00Z', amountKopecks: 100_000 },
        { at: '2026-09-17T10:02:00Z', amountKopecks: 500_000 }
      ])
    )

    expect(result.correctionKopecks).toBe(400)
  })

  /**
   * It may correct upward and it may **not** declare a payment missing: it has
   * not looked where the rest of the window would be, and reading that as "no
   * credit at all" is the failure the whole design exists to make impossible.
   */
  it('reports nothing unsettled when it saw only part of the window', () => {
    const result = correct([order({ declaredAmount: 99_600 })], stopsEarly([]))

    expect(result.unsettled).toEqual([])
    expect(result.correctionKopecks).toBe(0)
  })

  /** …and a document covering the whole window still says so. */
  it('still reports an unsettled claim when it covered everything', () => {
    const result = correct([order({ declaredAmount: 99_600 })], statement([]))

    expect(result.unsettled).toEqual([{ orderId: 1, declaredKopecks: 99_600 }])
  })

  /** A document from another day reaches none of it and says nothing at all. */
  it('leaves an order it cannot reach entirely alone', () => {
    const elsewhere = {
      ...(statement([{ at: '2026-09-20T10:01:00Z', amountKopecks: 100_000 }]) as unknown as Record<
        string,
        unknown
      >),
      periodFrom: new Date('2026-09-20T00:00:00Z'),
      periodTo: new Date('2026-09-20T23:59:59Z')
    } as never

    const result = correct([order({ declaredAmount: 99_600 })], elsewhere)

    expect(result).toEqual({ correctionKopecks: 0, corrected: [], unsettled: [] })
  })
})
