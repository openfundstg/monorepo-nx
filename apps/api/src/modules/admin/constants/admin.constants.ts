import { AdminSortDirection } from '@transacto/contracts'

/** Paging bounds and defaults, applied to every admin list. */
export const ADMIN_PAGE = {
  DEFAULT_LIMIT: 25,
  /**
   * The ceiling a client may ask for.
   *
   * Every list here is unscoped — it spans every trader and every user — so an
   * unbounded `limit` is a request to load a whole collection into memory. The
   * DTO clamps rather than rejects: an operator asking for 500 rows wants a lot
   * of rows, not an error.
   */
  MAX_LIMIT: 200,
  DEFAULT_DIRECTION: AdminSortDirection.DESC,
  /** How many rows a detail page embeds before linking out to the full list. */
  DETAIL_PREVIEW: 10
} as const

/**
 * Sort fields each list will accept, keyed by resource.
 *
 * An allow-list rather than passing the query string through to Mongo. A free
 * `sort` parameter lets a caller sort on an unindexed field and turn a paged
 * read into a collection scan, and `{ sort: { $where: … } }` is worse than
 * that.
 */
export const ADMIN_SORTABLE = {
  USERS: [
    'createdAt',
    'balance',
    'frozenBalance',
    'referralBalance',
    'totalTurnover',
    'telegramId'
  ],
  SALES: ['createdAt', 'fiatAmount', 'receivedAmount', 'completedAt', 'status'],
  DEPOSITS: ['createdAt', 'cryptoAmount', 'verifiedAt', 'status'],
  FIAT_DEPOSITS: ['createdAt', 'amountUah', 'coveredUah', 'holdUntilAt', 'completedAt', 'status'],
  REFERRALS: ['createdAt', 'amount', 'fiatAmount'],
  TERMINALS: ['createdAt', 'updatedAt', 'lastBalance', 'lastBalanceAt', 'terminalName'],
  TERMINAL_HISTORY: ['timestamp', 'balance', 'delta'],
  ORDERS: ['createdAt', 'amount', 'lastSyncAt', 'status'],
  TRADERS: ['createdAt', 'traderId'],
  ALERTS: ['createdAt', 'amount', 'status'],
  SAFE_BOX: ['createdAt', 'amount', 'status'],
  SUPPORT_TOPICS: ['createdAt', 'updatedAt', 'lastUserMessageAt'],
  FIAT_DEPOSIT_WATCHES: ['createdAt', 'minAmountUah', 'maxAmountUah', 'lastNotifiedAt'],
  SUPPORT_USERS: ['createdAt', 'lastSeenAt'],
  AUDIT: ['createdAt']
} as const

/**
 * Longest free-text search a list will act on.
 *
 * The search term becomes a regular expression, and an unbounded one is a
 * denial of service dressed up as a filter.
 */
export const ADMIN_SEARCH_MAX_LENGTH = 64

/** Longest reason an operator may attach to an action. Recorded verbatim. */
export const ADMIN_REASON_MAX_LENGTH = 500

/**
 * The single Socket.IO room on the `/admin` namespace.
 *
 * Everyone logged in sits in it. There is one admin identity and a handful of
 * operators, so there is nothing to partition — and a room per resource would
 * buy nothing but join/leave plumbing on every navigation.
 */
export const ADMIN_ROOM = 'admin'
