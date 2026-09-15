import type {
  AlertType,
  BankProvider,
  SaleRemainderPolicy,
  TerminalHistory,
  TerminalSource
} from '@transacto/contracts'

export interface Terminal {
  id?: string
  cardId?: number
  /**
   * Numeric, matching the Mongo schema and both the REST dashboard and the
   * socket events. It was previously typed `string` while numbers were stored,
   * so every `===` lookup against a socket payload silently missed.
   */
  terminalId?: number
  sendId?: string
  terminalName?: string
  bankProvider?: BankProvider
  /** How the terminal was created; drives the TG badge and the type filter. */
  source?: TerminalSource
  url?: string
  name?: string
  balance: number
  goal?: number
  hasPendingOrders?: boolean
  /**
   * Whether new payers are still routed here.
   *
   * Absent on a payload older than the field, which means routing normally —
   * so the card reads `=== false`, never falsy.
   */
  acceptingOrders?: boolean
  pendingOrdersSum?: number
  enabled?: boolean
  /**
   * What the Mini App order behind this terminal does with a remainder no
   * payment can cover.
   *
   * The trader-facing meaning is whether this jar will ever ask them for
   * anything. Absent on a terminal the trader created themselves — which has
   * no sale behind it, and so no such promise either way.
   */
  remainderPolicy?: SaleRemainderPolicy
  status: string
  lastUpdated?: Date
  /**
   * When `balance` and `goal` were last observed.
   *
   * Only set on terminals that came back from the network search. A jar the
   * dashboard is showing is being polled, so its figures are current and saying
   * so adds nothing; a switched-off one is not, and its balance is however old
   * it is. Showing that number without its age would present it as now.
   */
  balanceAt?: Date
  /**
   * False when no balance was ever recorded — `balance` is then a placeholder.
   *
   * Terminals disabled before the figures started being persisted have nothing
   * stored anywhere, and rendering that as "₴0.00" would claim an empty jar
   * rather than an unknown one.
   */
  balanceKnown?: boolean
}

/**
 * An alert as it arrives from the backend.
 *
 * There is no `message`: `type` is the translation key and `metadata` carries
 * its parameters, so the same alert renders in whichever language the trader
 * has selected. See `AlertMetadataMap` in contracts for the shape per type.
 */
export interface AlertData {
  _id?: string
  id?: string
  terminalId?: number
  type: AlertType | string
  amount?: number
  left?: number
  goal?: number
  metadata?: Record<string, unknown>
  isRead: boolean
  timestamp: Date | string
}

/**
 * One rendered history row: the three money columns, each with the movement
 * since the row below.
 *
 * Derived once per `logs` change rather than by per-index methods called from
 * the template, which ran three times per row on every change detection and,
 * being three separate implementations, let the actual-balance column quietly
 * behave differently from the other two.
 */
/**
 * Both moved to `@transacto/history-table` with the table that renders them,
 * and are re-exported here so this app's existing importers are untouched.
 */
export type { HistoryLog, HistoryRow } from '@transacto/history-table'

/**
 * One page of terminal search results.
 *
 * `total` is the server's count of everything that matched, not the length of
 * `terminals` — the response is capped, and a trader who cannot find their jar
 * needs to be told the list was cut rather than left to conclude it is gone.
 */
export interface TerminalSearchResult {
  readonly terminals: readonly Terminal[]
  readonly total: number
}
