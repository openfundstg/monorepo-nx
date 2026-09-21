import { AdminSortDirection, SaleCardOrderState } from '@transacto/contracts'

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
  /**
   * The **projected** names, not either collection's own.
   *
   * The deposits book is two collections read as one, and the sort runs after
   * the union — so what may be sorted on is what the pipeline produced. Listing
   * `cryptoAmount` here would name a field that no longer exists by the time
   * the sort sees it.
   */
  DEPOSITS: ['createdAt', 'cryptoCents', 'fiatAmount', 'completedAt', 'status'],
  /** Projected names again, for the same reason. */
  DOCUMENTS: ['uploadedAt', 'sizeBytes', 'status'],
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

/**
 * The card-order states an operator has anything to do about.
 *
 * A denial, and a statement that contradicted nothing. Everything else is
 * either still the seller's to answer or already settled, and neither is a
 * queue.
 *
 * **One home, because three screens read it**: the dispute chip on the sales
 * book selects rows by it, the mapper picks *which* order a row shows by it,
 * and the overview counts it. Three copies were written before this was one,
 * and the way that fails is quiet — a count that disagrees with the list it
 * links to, which is the one thing a dashboard figure must never do.
 */
export const DISPUTED_CARD_ORDER_STATES = [
  SaleCardOrderState.DISPUTED,
  SaleCardOrderState.PROVEN_UNPAID
] as const
