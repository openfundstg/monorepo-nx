import { awaitsStatementCheckpoint } from 'src/shared/utils'

const HOUR = 60 * 60 * 1000
const GRACE = 3 * HOUR

/**
 * A card order as the settlement decision reads one.
 *
 * `confirmDeadlineAt` is what matters here and `answeredAt` no longer appears:
 * a claim's window runs to the deadline plus the grace, and the answer is made
 * within a minute of the order arriving. Reading the answer asked whether the
 * document existed; reading the window asks whether it looked.
 */
const order = (overrides: Record<string, unknown> = {}) => ({
  amount: 100_000,
  declaredAmount: undefined as number | undefined,
  confirmDeadlineAt: new Date('2026-09-17T10:06:00Z'),
  ...overrides
})

describe('awaitsStatementCheckpoint', () => {
  it('holds nothing when nobody claimed a shortfall', () => {
    expect(
      awaitsStatementCheckpoint(
        { cardOrders: [order(), order()], statementCheckpointAt: null },
        GRACE
      )
    ).toBe(false)
  })

  /** A jar sale has no card orders, so it can never be holding a claim. */
  it('holds nothing on a sale with no card orders at all', () => {
    expect(awaitsStatementCheckpoint({}, GRACE)).toBe(false)
  })

  it('holds a claim no statement has reached', () => {
    expect(
      awaitsStatementCheckpoint(
        { cardOrders: [order({ declaredAmount: 99_500 })], statementCheckpointAt: null },
        GRACE
      )
    ).toBe(true)
  })

  /**
   * The checkpoint is a moment, not a count. A statement covering a period
   * settles every claim whose window closed inside it — including ones it was
   * not addressed to.
   */
  it('releases a claim whose whole window the checkpoint reaches past', () => {
    expect(
      awaitsStatementCheckpoint(
        {
          cardOrders: [order({ declaredAmount: 99_500 })],
          // 10:06 + 3h = 13:06, and the document runs past it.
          statementCheckpointAt: new Date('2026-09-17T14:00:00Z')
        },
        GRACE
      )
    ).toBe(false)
  })

  /**
   * **The bug this pins, and it cost a real ₴4.**
   *
   * A statement that stops inside a claim's window has *skipped* that order in
   * `statementCorrection` — it cannot speak for a stretch it does not cover. It
   * used to settle the claim anyway, because this asked about `answeredAt`,
   * which is a minute after the order arrives and therefore inside any document
   * at all. On sale 73GFZ7F9 the understatement was neither corrected nor held,
   * and the same predicate gates uploads, so the door to a second statement was
   * shut behind it.
   */
  it('keeps holding a claim whose window the checkpoint stops inside', () => {
    expect(
      awaitsStatementCheckpoint(
        {
          cardOrders: [order({ declaredAmount: 99_500 })],
          // The end of that day, hours before 13:06 + nothing. The window ends
          // at 13:06; a document stopping at 11:00 has not seen all of it.
          statementCheckpointAt: new Date('2026-09-17T11:00:00Z')
        },
        GRACE
      )
    ).toBe(true)
  })

  it('keeps holding a claim made after the checkpoint', () => {
    expect(
      awaitsStatementCheckpoint(
        {
          cardOrders: [
            order({ declaredAmount: 99_500, confirmDeadlineAt: new Date('2026-09-17T06:00:00Z') }),
            order({ declaredAmount: 99_000, confirmDeadlineAt: new Date('2026-09-17T14:00:00Z') })
          ],
          statementCheckpointAt: new Date('2026-09-17T12:00:00Z')
        },
        GRACE
      )
    ).toBe(true)
  })

  /**
   * **A correction is capped at the order's own amount**, so once a document
   * has shown the whole of it there is nothing a later one could move. Holding
   * on would ask a seller for a statement covering hours in which, by
   * construction, no figure can change.
   */
  it('releases a claim a statement has proved in full', () => {
    expect(
      awaitsStatementCheckpoint(
        {
          cardOrders: [order({ declaredAmount: 99_500, provenAmount: 100_000 })],
          statementCheckpointAt: new Date('2026-09-17T11:00:00Z')
        },
        GRACE
      )
    ).toBe(false)
  })

  /** …and a partial proof is not that. The rest of the window still counts. */
  it('keeps holding a claim a statement only partly proved', () => {
    expect(
      awaitsStatementCheckpoint(
        {
          cardOrders: [order({ declaredAmount: 99_500, provenAmount: 99_800 })],
          statementCheckpointAt: new Date('2026-09-17T11:00:00Z')
        },
        GRACE
      )
    ).toBe(true)
  })
})
