import { awaitsStatementCheckpoint } from 'src/shared/utils'

/** A card order as the settlement decision reads one. */
const order = (overrides: Record<string, unknown> = {}) => ({
  declaredAmount: undefined as number | undefined,
  answeredAt: new Date('2026-09-17T10:30:00Z'),
  ...overrides
})

describe('awaitsStatementCheckpoint', () => {
  it('holds nothing when nobody claimed a shortfall', () => {
    expect(
      awaitsStatementCheckpoint({ cardOrders: [order(), order()], statementCheckpointAt: null })
    ).toBe(false)
  })

  /** A jar sale has no card orders, so it can never be holding a claim. */
  it('holds nothing on a sale with no card orders at all', () => {
    expect(awaitsStatementCheckpoint({})).toBe(false)
  })

  it('holds a claim no statement has reached', () => {
    expect(
      awaitsStatementCheckpoint({
        cardOrders: [order({ declaredAmount: 99_500 })],
        statementCheckpointAt: null
      })
    ).toBe(true)
  })

  /**
   * The checkpoint is a moment, not a count. A statement covering a period
   * settles every claim made inside it — including ones it was not addressed to.
   */
  it('releases a claim the checkpoint reaches past', () => {
    expect(
      awaitsStatementCheckpoint({
        cardOrders: [order({ declaredAmount: 99_500 })],
        statementCheckpointAt: new Date('2026-09-17T12:00:00Z')
      })
    ).toBe(false)
  })

  it('keeps holding a claim made after the checkpoint', () => {
    expect(
      awaitsStatementCheckpoint({
        cardOrders: [
          order({ declaredAmount: 99_500, answeredAt: new Date('2026-09-17T09:00:00Z') }),
          order({ declaredAmount: 99_000, answeredAt: new Date('2026-09-17T14:00:00Z') })
        ],
        statementCheckpointAt: new Date('2026-09-17T12:00:00Z')
      })
    ).toBe(true)
  })

  /**
   * An unanswered order carrying a figure is a state that should not occur —
   * the figure is written by the answer. Read as unchecked rather than checked:
   * being wrong here holds a refund for a document, and being wrong the other
   * way releases money on a claim nobody verified.
   */
  it('treats a claim with no answer time as unchecked', () => {
    expect(
      awaitsStatementCheckpoint({
        cardOrders: [order({ declaredAmount: 99_500, answeredAt: null })],
        statementCheckpointAt: new Date('2026-09-17T12:00:00Z')
      })
    ).toBe(true)
  })
})
