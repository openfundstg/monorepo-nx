import {
  SaleRemainderPolicy,
  TerminalSource,
  TmaFiatReceiptStatus,
  type AdminAlertListItem,
  type AdminAuditLogItem,
  type AdminCardOrderListItem,
  type AdminCardOrderStatement,
  type AdminDepositListItem,
  type AdminFiatDepositListItem,
  type AdminFiatDepositWatchListItem,
  type AdminOrderListItem,
  type AdminReferralEarningListItem,
  type AdminSafeBoxListItem,
  type AdminSaleListItem,
  type AdminSupportTopicListItem,
  type AdminSupportUserListItem,
  type AdminTerminalHistoryItem,
  type AdminTerminalListItem,
  type TerminalHistoryAlert,
  type TerminalHistoryOrderEvent,
  type AdminTmaUserListItem,
  type AdminTraderListItem,
  type BankProvider
} from '@transacto/contracts'
import { getTrustLevel } from 'src/shared/constants'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import { getBankProvider, saleRefundSplit } from 'src/shared/utils'
import { allowedSaleActions } from './sale-actions.util'
import type { StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import type { TmaSale, TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import type { Types } from 'mongoose'

/**
 * Stored document → wire row, for every collection the panel lists.
 *
 * Pure functions in `utils/` rather than methods on the services, because the
 * same row shape is produced from three places — a list, a detail page's
 * embedded preview, and a realtime push — and a mapper that lives on one
 * service is a mapper the other two reimplement slightly differently. That
 * divergence is exactly what makes a live-patched row disagree with the same
 * row after a refresh.
 *
 * Everything they need beyond the document is passed in. None of them reads a
 * database, a clock or request state.
 *
 * **Dates become ISO strings here and nowhere else.** JSON has no date, so it
 * happens somewhere regardless; doing it once at the boundary keeps every list
 * agreeing on the format, and keeps `new Date(...)` out of the panel's guesses.
 */

/** `null` for an absent date rather than an empty string, so a client can test it. */
const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null

/** For fields the schema guarantees — `createdAt` and friends. */
const isoRequired = (value: Date): string => new Date(value).toISOString()

// --- TMA users -------------------------------------------------------------

/**
 * `openOrders` comes from the caller because it is a count across another
 * collection, aggregated once for a whole page rather than per row.
 */
export const toAdminUser = (user: StoredTmaUser, openOrders: number): AdminTmaUserListItem => ({
  telegramId: user.telegramId,
  firstName: user.firstName,
  lastName: user.lastName,
  username: user.username,
  balance: user.balance,
  frozenBalance: user.frozenBalance,
  referralBalance: user.referralBalance,
  totalTurnover: user.totalTurnover,
  // Derived, never stored — the same rule the Mini App's own profile follows,
  // so the badge here and the badge there cannot disagree.
  trustLevel: getTrustLevel(user.totalTurnover).level,
  isActive: user.isActive,
  referralCode: user.referralCode,
  referredBy: user.referredBy,
  openOrders,
  createdAt: isoRequired(user.createdAt)
})

// --- Sales ---------------------------------------------------------

/** A sale as stored, with the owner's display name folded in by the caller. */
export const toAdminSale = (
  order: {
    _id: { toString(): string }
    publicId: string
    telegramId: number
    fiatAmount: number
    receivedAmount: number
    jarBalance: number | null
    exchangeRate: number
    frozenUsdt: number
    bankType: string
    dropLink: string
    status: AdminSaleListItem['status']
    blockReason: AdminSaleListItem['blockReason']
    remainderPolicy?: SaleRemainderPolicy
    transactoTerminalId: number | null
    cardId: number | null
    traderId: number | null
    receiverName: string | null
    // Read by the refund split alongside `receivedAmount` — hryvnia can reach a
    // jar without a settled order to attribute it to.
    openingJarBalance?: number | null
    jarClosedAt: Date | null
    completedAt: Date | null
    createdAt: Date
  },
  username: string
): AdminSaleListItem => ({
  id: order._id.toString(),
  publicId: order.publicId,
  telegramId: order.telegramId,
  username,
  fiatAmount: order.fiatAmount,
  receivedAmount: order.receivedAmount,
  jarBalance: order.jarBalance,
  exchangeRate: order.exchangeRate,
  frozenUsdt: order.frozenUsdt,
  bankType: order.bankType,
  dropLink: order.dropLink,
  status: order.status,
  blockReason: order.blockReason,
  // A lean read applies no Mongoose default, so orders written before the
  // choice existed carry nothing — and `WAIT_FOR_TOP_UP` is what they did.
  remainderPolicy: order.remainderPolicy ?? SaleRemainderPolicy.WAIT_FOR_TOP_UP,
  transactoTerminalId: order.transactoTerminalId,
  cardId: order.cardId,
  traderId: order.traderId,
  receiverName: order.receiverName,
  jarClosedAt: iso(order.jarClosedAt),
  completedAt: iso(order.completedAt),
  createdAt: isoRequired(order.createdAt),
  // Decided here rather than by the panel — see `allowedSaleActions`.
  allowedActions: allowedSaleActions(order),
  // The figure a cancellation would pay, from the same helper the settlement
  // uses — so the number in the dialog is the number that moves.
  suggestedRefundCents: saleRefundSplit(order).refunded
})

// --- Deposits --------------------------------------------------------------

/**
 * A fiat top-up as the panel lists it.
 *
 * The receipt counts are derived here rather than shipped as the receipts
 * themselves: a list row needs "two uploaded, one accepted" and nothing else,
 * and sending the array would put every payer's parsed receipt fields — names,
 * IBANs — into a table nobody reads them from.
 */
export const toAdminFiatDeposit = (
  deposit: TmaFiatDepositRecord,
  username: string
): AdminFiatDepositListItem => ({
  id: deposit._id.toString(),
  telegramId: deposit.telegramId,
  username,
  payoutId: deposit.payoutId,
  amountUah: deposit.amountUah,
  coveredUah: deposit.coveredUah,
  cryptoCents: deposit.cryptoCents,
  exchangeRate: deposit.exchangeRate,
  status: deposit.status,
  recipientCard: deposit.recipientCard,
  receiptCount: deposit.receipts.length,
  acceptedReceiptCount: deposit.receipts.filter(
    (receipt) => receipt.status === TmaFiatReceiptStatus.ACCEPTED
  ).length,
  payDeadlineAt: deposit.payDeadlineAt.toISOString(),
  holdUntilAt: deposit.holdUntilAt.toISOString(),
  completedAt: deposit.completedAt?.toISOString() ?? null,
  createdAt: deposit.createdAt.toISOString()
})

export const toAdminDeposit = (
  deposit: {
    _id: { toString(): string }
    telegramId: number
    cryptoAmount: number
    fiatEquivalent: number
    exchangeRate: number
    status: AdminDepositListItem['status']
    txId: string | null
    expiresAt: Date
    verifiedAt: Date | null
    createdAt: Date
  },
  username: string
): AdminDepositListItem => ({
  id: deposit._id.toString(),
  telegramId: deposit.telegramId,
  username,
  cryptoAmount: deposit.cryptoAmount,
  fiatEquivalent: deposit.fiatEquivalent,
  exchangeRate: deposit.exchangeRate,
  status: deposit.status,
  txId: deposit.txId,
  expiresAt: isoRequired(deposit.expiresAt),
  verifiedAt: iso(deposit.verifiedAt),
  createdAt: isoRequired(deposit.createdAt)
})

// --- Referrals -------------------------------------------------------------

export const toAdminReferralEarning = (
  earning: {
    _id: { toString(): string }
    referrerTelegramId: number
    referredTelegramId: number
    amount: number
    fiatAmount: number
    exchangeRate: number
    ratePercent: number
    createdAt: Date
  },
  referrerUsername: string,
  referredUsername: string
): AdminReferralEarningListItem => ({
  id: earning._id.toString(),
  referrerTelegramId: earning.referrerTelegramId,
  referrerUsername,
  referredTelegramId: earning.referredTelegramId,
  referredUsername,
  amount: earning.amount,
  fiatAmount: earning.fiatAmount,
  exchangeRate: earning.exchangeRate,
  ratePercent: earning.ratePercent,
  createdAt: isoRequired(earning.createdAt)
})

// --- Terminals -------------------------------------------------------------

export const toAdminTerminal = (terminal: {
  _id: { toString(): string }
  traderId: number
  cardId: number
  terminalId?: number
  terminalName: string
  source?: TerminalSource
  cred3: string | null
  enabled: boolean
  acceptingOrders?: boolean
  lastBalance: number | null
  lastGoal: number | null
  lastBalanceAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AdminTerminalListItem => ({
  id: terminal._id.toString(),
  traderId: terminal.traderId,
  cardId: terminal.cardId,
  terminalId: terminal.terminalId ?? null,
  terminalName: terminal.terminalName,
  // Both of these post-date the collection and a lean read applies no default,
  // so the fallbacks are the behaviour those rows actually had — a terminal
  // with no `source` was created through Transacto, and one with no
  // `acceptingOrders` was routing normally.
  source: terminal.source ?? TerminalSource.TRANSACTO,
  bankProvider: getBankProvider(terminal.cred3),
  url: terminal.cred3,
  enabled: terminal.enabled,
  // The stored flag only means something while the terminal is in service: a
  // teardown resets it to `true` on purpose (see `TerminalDeactivationService.
  // deactivate`), so read raw it put "accepting orders" beside every dead jar.
  acceptingOrders: terminal.enabled && (terminal.acceptingOrders ?? true),
  lastBalance: terminal.lastBalance,
  lastGoal: terminal.lastGoal,
  lastBalanceAt: iso(terminal.lastBalanceAt),
  createdAt: isoRequired(terminal.createdAt),
  updatedAt: isoRequired(terminal.updatedAt)
})

/**
 * The stored record, passed through whole.
 *
 * Only `_id` and `timestamp` are touched, and only because JSON has neither an
 * ObjectId nor a Date. Everything else — `executionReason` above all — reaches
 * the shared table exactly as the scraper wrote it, which is what makes the
 * panel's history identical to the extension's rather than merely similar.
 */
export const toAdminTerminalHistory = (entry: {
  _id: { toString(): string }
  cardId: number
  traderId: number
  timestamp: Date
  balance: number
  baseline: number
  expectedBalance: number
  delta: number
  orderEvents: TerminalHistoryOrderEvent[]
  alerts: TerminalHistoryAlert[]
}): AdminTerminalHistoryItem => ({
  id: entry._id.toString(),
  cardId: entry.cardId,
  traderId: entry.traderId,
  timestamp: isoRequired(entry.timestamp),
  balance: entry.balance,
  baseline: entry.baseline,
  expectedBalance: entry.expectedBalance,
  delta: entry.delta,
  orderEvents: entry.orderEvents,
  alerts: entry.alerts
})

// --- Transacto orders ------------------------------------------------------

export const toAdminOrder = (order: {
  _id: { toString(): string }
  orderId: number
  orderStringId: string
  traderId: number
  cardId: number
  amount: number
  actualAmount?: number
  status: AdminOrderListItem['status']
  executionReason?: string
  awaitingUpstreamConfirmation: boolean
  enqueuedAt: Date
  lastSyncAt: Date
  createdAt: Date
}): AdminOrderListItem => ({
  id: order._id.toString(),
  orderId: order.orderId,
  orderStringId: order.orderStringId,
  traderId: order.traderId,
  cardId: order.cardId,
  amount: order.amount,
  actualAmount: order.actualAmount ?? null,
  status: order.status,
  executionReason: order.executionReason ?? null,
  awaitingUpstreamConfirmation: order.awaitingUpstreamConfirmation,
  enqueuedAt: isoRequired(order.enqueuedAt),
  lastSyncAt: isoRequired(order.lastSyncAt),
  createdAt: isoRequired(order.createdAt)
})

// --- Traders ---------------------------------------------------------------

/**
 * Note the absent `apiToken`. It is dropped by the projection in
 * `TraderDbService.findPage`, so it is not merely unmapped here — it never
 * leaves Mongo. See the note there.
 */
export const toAdminTrader = (
  trader: { _id: { toString(): string }; traderId: number; isActive: boolean; createdAt: Date },
  terminals: { total: number; enabled: number },
  pendingAlerts: number
): AdminTraderListItem => ({
  id: trader._id.toString(),
  traderId: trader.traderId,
  isActive: trader.isActive,
  terminalsTotal: terminals.total,
  terminalsEnabled: terminals.enabled,
  pendingAlerts,
  createdAt: isoRequired(trader.createdAt)
})

// --- Alerts & safe box -----------------------------------------------------

export const toAdminAlert = (alert: {
  _id: { toString(): string }
  traderId: number
  terminalId: number
  type: AdminAlertListItem['type']
  status: AdminAlertListItem['status']
  amount: number
  isRead: boolean
  metadata?: AdminAlertListItem['metadata']
  createdAt: Date
}): AdminAlertListItem => ({
  id: alert._id.toString(),
  traderId: alert.traderId,
  terminalId: alert.terminalId,
  type: alert.type,
  status: alert.status,
  amount: alert.amount,
  isRead: alert.isRead,
  // Passed straight through: the panel renders `'ALERTS.' + type` with these as
  // arguments, exactly as the extension does. Reshaping them here would make
  // the two frontends need different translations for the same alert.
  metadata: alert.metadata ?? null,
  createdAt: isoRequired(alert.createdAt)
})

export const toAdminSafeBox = (deposit: {
  _id: { toString(): string }
  traderId: number
  terminalId: number
  amount: number
  originalDelta?: number
  status: string
  comment?: string
  linkedOrderId?: number
  alertCreatedAt: Date
  createdAt: Date
}): AdminSafeBoxListItem => ({
  id: deposit._id.toString(),
  traderId: deposit.traderId,
  terminalId: deposit.terminalId,
  amount: deposit.amount,
  originalDelta: deposit.originalDelta ?? null,
  status: deposit.status,
  comment: deposit.comment ?? null,
  linkedOrderId: deposit.linkedOrderId ?? null,
  alertCreatedAt: isoRequired(deposit.alertCreatedAt),
  createdAt: isoRequired(deposit.createdAt)
})

// --- Support ---------------------------------------------------------------

export const toAdminSupportTopic = (topic: {
  _id: { toString(): string }
  telegramId: number
  messageThreadId: number
  displayName: string
  status: AdminSupportTopicListItem['status']
  lastUserMessageAt: Date | null
  lastAdminMessageAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AdminSupportTopicListItem => ({
  id: topic._id.toString(),
  telegramId: topic.telegramId,
  messageThreadId: topic.messageThreadId,
  displayName: topic.displayName,
  status: topic.status,
  lastUserMessageAt: iso(topic.lastUserMessageAt),
  lastAdminMessageAt: iso(topic.lastAdminMessageAt),
  closedAt: iso(topic.closedAt),
  createdAt: isoRequired(topic.createdAt),
  updatedAt: isoRequired(topic.updatedAt)
})

/**
 * `hasTmaAccount` is supplied by the caller.
 *
 * Anyone can message the bot without ever opening the Mini App, so the two
 * collections are joined on `telegramId` and never by a foreign key — which
 * means "does this person also have an account?" is a lookup, not a field.
 */
export const toAdminSupportUser = (
  user: {
    _id: { toString(): string }
    telegramId: number
    firstName: string
    lastName: string
    username: string
    languageCode: string
    preferredLocale: AdminSupportUserListItem['preferredLocale']
    lastSeenAt: Date | null
    createdAt: Date
    updatedAt: Date
  },
  hasTmaAccount: boolean
): AdminSupportUserListItem => ({
  id: user._id.toString(),
  telegramId: user.telegramId,
  firstName: user.firstName,
  lastName: user.lastName,
  username: user.username,
  languageCode: user.languageCode,
  preferredLocale: user.preferredLocale,
  lastSeenAt: iso(user.lastSeenAt),
  hasTmaAccount,
  createdAt: isoRequired(user.createdAt),
  updatedAt: isoRequired(user.updatedAt)
})

// --- Audit -----------------------------------------------------------------

export const toAdminAuditEntry = (entry: {
  _id: { toString(): string }
  actor: string
  action: AdminAuditLogItem['action']
  targetType: AdminAuditLogItem['targetType']
  targetId: string
  reason: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: Date
}): AdminAuditLogItem => ({
  id: entry._id.toString(),
  actor: entry.actor,
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId,
  reason: entry.reason,
  metadata: entry.metadata,
  ip: entry.ip,
  createdAt: isoRequired(entry.createdAt)
})

/**
 * A display name for a user we may not have a row for.
 *
 * Every list that names somebody goes through this, so a deleted or
 * never-created user reads the same way everywhere instead of as `undefined` on
 * one screen and a blank cell on another.
 */
export const displayName = (
  user: { username?: string; firstName?: string; lastName?: string } | undefined,
  telegramId: number
): string => {
  if (!user) return String(telegramId)
  if (user.username) return `@${user.username}`

  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

  return full || String(telegramId)
}

/**
 * A standing request for an amount, as the panel draws it.
 *
 * Carries no figure about the person beyond their id and name: a request is a
 * range and somebody who wants it, and everything else about them is one click
 * away in the users list.
 */
export const toAdminFiatDepositWatch = (
  watch: {
    _id: { toString(): string }
    telegramId: number
    minAmountUah: number
    maxAmountUah: number
    mode: AdminFiatDepositWatchListItem['mode']
    lastNotifiedAt: Date | null
    createdAt: Date
  },
  username: string
): AdminFiatDepositWatchListItem => ({
  id: watch._id.toString(),
  telegramId: watch.telegramId,
  username,
  minAmountUah: watch.minAmountUah,
  maxAmountUah: watch.maxAmountUah,
  mode: watch.mode,
  lastNotifiedAt: watch.lastNotifiedAt?.toISOString() ?? null,
  createdAt: watch.createdAt.toISOString()
})

/**
 * One disputed card payment, as the panel lists it.
 *
 * Here rather than in the service, with the other fifteen: a mapper is what a
 * stored document looks like to an operator, and keeping them together is what
 * stops two screens disagreeing about how the same figure renders.
 *
 * **No card number in any form, not even four digits.** Closing an appeal does
 * not need one, and this row is rendered in a browser.
 */
export const toAdminCardOrder = (
  sale: TmaSale & { _id: Types.ObjectId },
  cardOrder: TmaSaleCardOrder
): AdminCardOrderListItem => ({
  orderId: cardOrder.orderId,
  saleId: sale._id.toString(),
  publicId: sale.publicId,
  telegramId: sale.telegramId,
  state: cardOrder.state,
  amount: cardOrder.amount,
  arrivedAt: cardOrder.arrivedAt.toISOString(),
  confirmDeadlineAt: cardOrder.confirmDeadlineAt.toISOString(),
  answeredAt: cardOrder.answeredAt?.toISOString() ?? null,
  receiverName: sale.receiverName,
  receiverNameSource: sale.receiverNameSource,
  bankType: sale.bankType as BankProvider,
  // Counts and verdicts, never the documents: a row carrying them would put the
  // period, the holder and the account tail of somebody's bank statement into a
  // table nobody reads them from. What an operator opens is the file itself.
  statements: (cardOrder.statements ?? []).map(
    (statement): AdminCardOrderStatement => ({
      id: statement._id.toString(),
      bank: statement.bank,
      status: statement.status,
      rejection: statement.rejection,
      uploadedAt: statement.uploadedAt.toISOString(),
      sizeBytes: statement.sizeBytes,
      periodFrom: statement.periodFrom?.toISOString() ?? null,
      periodTo: statement.periodTo?.toISOString() ?? null,
      ownerName: statement.ownerName
    })
  )
})
