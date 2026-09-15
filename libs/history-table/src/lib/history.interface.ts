import type { TerminalHistory } from '@transacto/contracts'

/**
 * A history row as the table renders it: the stored record plus the two fields
 * the UI derives locally.
 */
export interface HistoryLog extends TerminalHistory {
  _id?: string
  /** Sum of still-pending orders, shown when the balance has not moved yet. */
  expectedDelta?: number
  /** Set on rows that arrived over the socket, so they can animate in. */
  isNew?: boolean
}

/** One rendered row, with every money column's movement worked out once. */
export interface HistoryRow {
  readonly log: HistoryLog
  readonly balance: number
  readonly balanceDelta?: number
  readonly expectedBalance?: number
  readonly expectedDelta?: number
  /** Money in the jar that no matched order accounts for. */
  readonly unrecognized?: number
  readonly unrecognizedDelta?: number
}
