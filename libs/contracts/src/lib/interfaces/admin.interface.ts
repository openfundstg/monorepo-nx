import type {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminBalanceOperation,
  AdminBalanceTarget,
  AdminFiatDepositAction,
  AdminSaleAction,
  AdminSortDirection,
} from '../enums/admin.enum.js';
import type { AlertStatus, AlertType } from '../enums/alert.enum.js';
import type { BankProvider } from '../enums/bank-provider.enum.js';
import type { OrderStatus } from '../enums/order-status.enum.js';
import type { TerminalSource } from '../enums/terminal-source.enum.js';
import type {
  SaleBlockReason,
  SaleRemainderPolicy,
  TmaDepositStatus,
  TmaSaleStatus,
  TrustLevel,
} from '../enums/tma.enum.js';
import type { FiatDepositWatchMode, TmaFiatDepositStatus } from '../enums/fiat-deposit.enum.js';
import type { SupportLocale, SupportTopicStatus } from '../enums/support.enum.js';
import type { AlertMetadata } from './alert.interface.js';
import type { TerminalHistory } from './terminal-history.interface.js';

// --- Paging ----------------------------------------------------------------

/**
 * The envelope every admin list comes back in.
 *
 * `total` is the count matching the filter, not the length of `items` — the
 * panel shows "41–60 of 812" and has to be able to say so without asking for
 * the whole collection.
 */
export interface AdminPaginatedRes<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * The query every admin list accepts.
 *
 * `search` is one free-text box rather than a field per column: an operator
 * looking somebody up has a Telegram id, a username or an order code in front
 * of them and does not know which one it is. Each list decides which of its own
 * fields that string is matched against.
 */
export interface AdminPageReq {
  readonly page?: number;
  readonly limit?: number;
  readonly search?: string;
  readonly sort?: string;
  readonly direction?: AdminSortDirection;
}

// --- Session ---------------------------------------------------------------

/** `POST /api/admin/auth/login`. */
export interface AdminLoginReq {
  readonly username: string;
  readonly password: string;
}

/**
 * `POST /api/admin/auth/login` and `GET /api/admin/auth/me`.
 *
 * The session id itself is never in this body — it is an `HttpOnly` cookie, so
 * script on the page cannot read it and an XSS cannot carry it off. What does
 * come back is the CSRF token, which is meant to be read by script and echoed
 * in `x-csrf-token`; that is the whole point of the double-submit pattern the
 * existing `CsrfGuard` implements.
 */
export interface AdminSessionRes {
  readonly username: string;
  /** Echo this in the `x-csrf-token` header on every state-changing request. */
  readonly csrfToken: string;
  /** ISO-8601. The session is gone after this, cookie or not. */
  readonly expiresAt: string;
}

// --- Overview --------------------------------------------------------------

/**
 * `GET /api/admin/overview` — the numbers the landing screen draws.
 *
 * Money figures keep the units they are stored in: USDT cents for balances,
 * UAH kopecks for turnover and volume. Formatting is the client's job, here as
 * everywhere else.
 */
export interface AdminOverviewRes {
  readonly users: {
    readonly total: number;
    readonly active: number;
    readonly newToday: number;
  };
  readonly balances: {
    /** Sum of every user's spendable balance, USDT cents. */
    readonly spendable: number;
    /** Sum of every user's frozen stake, USDT cents. */
    readonly frozen: number;
    /** Sum of every user's referral pot, USDT cents. */
    readonly referral: number;
  };
  readonly sales: {
    readonly open: number;
    readonly completedToday: number;
    /**
     * UAH kopecks of Transacto orders confirmed today on the Mini App's
     * terminals — the money that actually arrived, not the targets of the sales
     * that completed. A sale refunding its tail completes short of its target,
     * and one still running has been paid into already.
     */
    readonly volumeToday: number;
    /** How many sit in each status right now. */
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly deposits: {
    readonly pending: number;
    readonly completedToday: number;
    /** USDT, whole units — the figure users type on the deposit form. */
    readonly creditedToday: number;
  };
  readonly terminals: {
    readonly total: number;
    readonly enabled: number;
    readonly acceptingOrders: number;
  };
  readonly alerts: {
    readonly pending: number;
  };
}

// --- TMA users -------------------------------------------------------------

/** One row of `GET /api/admin/users`. */
export interface AdminTmaUserListItem {
  readonly telegramId: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string;
  /** USDT cents, spendable. */
  readonly balance: number;
  /** USDT cents, staked against running orders. */
  readonly frozenBalance: number;
  /** USDT cents in the referral pot. */
  readonly referralBalance: number;
  /** UAH kopecks, lifetime. */
  readonly totalTurnover: number;
  readonly trustLevel: TrustLevel;
  readonly isActive: boolean;
  readonly referralCode: string | null;
  readonly referredBy: number | null;
  /** How many sales are holding a slot right now. */
  readonly openOrders: number;
  readonly createdAt: string;
}

/**
 * `GET /api/admin/users/:telegramId`.
 *
 * The counters are computed rather than stored, so a detail page never
 * contradicts the lists it links to.
 */
export interface AdminTmaUserDetailRes {
  readonly user: AdminTmaUserListItem;
  readonly stats: {
    readonly salesTotal: number;
    readonly salesCompleted: number;
    readonly depositsTotal: number;
    /** USDT, whole units, across every completed deposit. */
    readonly depositedTotal: number;
    readonly referralsCount: number;
    /** USDT cents earned from referrals, lifetime. */
    readonly referralEarnedTotal: number;
  };
  /** Newest first, capped — the full list has its own paginated endpoint. */
  readonly recentSales: readonly AdminSaleListItem[];
  readonly recentDeposits: readonly AdminDepositListItem[];
}

/** `POST /api/admin/users/:telegramId/active`. */
export interface AdminSetUserActiveReq {
  readonly isActive: boolean;
  /** Recorded on the audit row. Free text, operator-facing, never shown to the user. */
  readonly reason: string;
}

/**
 * `POST /api/admin/users/:telegramId/balance` — a manual correction.
 *
 * `amountCents` is always positive; {@link AdminBalanceOperation} carries the
 * direction. A debit that would take the balance below zero is refused rather
 * than clamped: an operator who asked for more than is there has the wrong
 * figure, and silently writing a different one hides that.
 */
export interface AdminAdjustBalanceReq {
  readonly operation: AdminBalanceOperation;
  readonly target: AdminBalanceTarget;
  /** USDT cents, positive. */
  readonly amountCents: number;
  /** Mandatory. This is somebody's money — an unexplained movement is not acceptable. */
  readonly reason: string;
}

/** What the balances are after the correction landed. All USDT cents. */
export interface AdminAdjustBalanceRes {
  readonly balance: number;
  readonly frozenBalance: number;
  readonly referralBalance: number;
}

// --- Sales ---------------------------------------------------------

/** One row of `GET /api/admin/sales`. */
export interface AdminSaleListItem {
  readonly id: string;
  readonly publicId: string;
  readonly telegramId: number;
  /** Denormalised for the list only, so a row reads without a second request. */
  readonly username: string;
  /** UAH kopecks — the order's target. */
  readonly fiatAmount: number;
  /** UAH kopecks matched and executed so far. */
  readonly receivedAmount: number;
  /** UAH kopecks in the jar as the bank last reported it, or `null` if never scraped. */
  readonly jarBalance: number | null;
  /** UAH kopecks per USDT, snapshotted at creation. */
  readonly exchangeRate: number;
  /** USDT cents staked. */
  readonly frozenUsdt: number;
  readonly bankType: string;
  readonly dropLink: string;
  readonly status: TmaSaleStatus;
  readonly blockReason: SaleBlockReason | null;
  readonly remainderPolicy: SaleRemainderPolicy;
  readonly transactoTerminalId: number | null;
  readonly cardId: number | null;
  readonly traderId: number | null;
  readonly receiverName: string | null;
  readonly jarClosedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  /**
   * Which interventions this order can actually accept, right now.
   *
   * Computed server-side and sent per row rather than derived from `status` by
   * the client, because the rule is not one rule: cancelling refuses an order
   * that is already winding down, while blocking and completing accept it, and
   * none of the three accepts one that is already blocked. Those preconditions
   * live in the settlement services, and a client re-deriving them drifts the
   * first time one of them changes.
   *
   * The same choice `SaleProgress.canCancel` makes for the Mini App, for
   * the same reason: a menu entry that is offered and then refused is worse
   * than one that is not offered.
   */
  readonly allowedActions: readonly AdminSaleAction[];
  /**
   * What a refund would come to if the operator does not override it, in USDT
   * cents.
   *
   * The same arithmetic the user's own cancel button uses — the stake less what
   * the jar has already delivered, priced at the order's own snapshotted rate.
   * Sent so the dialog opens with the right number already in the field rather
   * than making an operator work it out, and so the audit row can record what
   * was suggested next to what was actually paid.
   */
  readonly suggestedRefundCents: number;
}

/**
 * `POST /api/admin/sales/:id/action`.
 *
 * One endpoint rather than three, because the three actions share their
 * preconditions and their audit shape, and an operator picks between them in
 * one dialog.
 */
export interface AdminSaleActionReq {
  readonly action: AdminSaleAction;
  readonly reason: string;
  /**
   * What to give back, in USDT cents. Only read by `CANCEL` and `RELEASE`.
   *
   * Absent means "use the figure the product would have used" — the stake less
   * whatever the jar already took in, which is what the user's own cancel
   * button computes. Present overrides it, for the cases an operator is looking
   * at precisely because the automatic answer is wrong.
   *
   * Bounded by the order's own `frozenUsdt` and refused above it. Refunding
   * more than was frozen would take money out of a pot that never held it and
   * leave the user's frozen balance permanently wrong; paying somebody *more*
   * than their stake is a balance correction, which is a separate, audited
   * action with its own reason.
   */
  readonly refundCents?: number;
}

// --- Deposits --------------------------------------------------------------

/** One row of `GET /api/admin/deposits`. */
export interface AdminDepositListItem {
  readonly id: string;
  readonly telegramId: number;
  readonly username: string;
  /** USDT, whole units — the figure the user typed. */
  readonly cryptoAmount: number;
  /** UAH kopecks at the snapshotted rate. */
  readonly fiatEquivalent: number;
  readonly exchangeRate: number;
  readonly status: TmaDepositStatus;
  readonly txId: string | null;
  readonly expiresAt: string;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
}

// --- Fiat top-ups ----------------------------------------------------------

/**
 * One row of `GET /api/admin/fiat-deposits`.
 *
 * Carries the recipient card in full. An operator reconciling one of these is
 * looking at the same payout in Transacto's own panel, and a masked number
 * cannot be matched against anything — which is the whole task.
 */
export interface AdminFiatDepositListItem {
  readonly id: string;
  readonly telegramId: number;
  readonly username: string;
  /** Transacto's payout id — the handle for finding it in their panel. */
  readonly payoutId: number;
  /** UAH kopecks the payout is for. */
  readonly amountUah: number;
  /** UAH kopecks Transacto has accepted receipts for. */
  readonly coveredUah: number;
  /** USDT cents to credit, frozen at reservation. */
  readonly cryptoCents: number;
  readonly exchangeRate: number;
  readonly status: TmaFiatDepositStatus;
  readonly recipientCard: string;
  readonly receiptCount: number;
  readonly acceptedReceiptCount: number;
  readonly payDeadlineAt: string;
  readonly holdUntilAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/**
 * One user's standing request to be told when an amount appears — the demand
 * the book is not meeting.
 *
 * A read-only list, and deliberately so: nothing an operator could do to one of
 * these rows would help the person who wrote it. What helps is creating a
 * payout in that range, which happens in Transacto's panel, not here. So the
 * screen exists to answer "what are people waiting for and how long have they
 * waited", and carries no actions at all.
 *
 * No card, no balance, no personal figures. A request is a range and a person,
 * and everything else about that person is one click away in the users list.
 */
export interface AdminFiatDepositWatchListItem {
  readonly id: string;
  readonly telegramId: number;
  readonly username: string;
  /** UAH kopecks. Inclusive. */
  readonly minAmountUah: number;
  /** UAH kopecks. Inclusive. */
  readonly maxAmountUah: number;
  readonly mode: FiatDepositWatchMode;
  /** ISO, or `null` when this request has never fired. */
  readonly lastNotifiedAt: string | null;
  readonly createdAt: string;
}

/** Body of `POST /api/admin/fiat-deposits/:id/action`. */
export interface AdminFiatDepositActionReq {
  readonly action: AdminFiatDepositAction;
  /**
   * Why. Required by the shape, not decorated onto it — an operator crediting
   * somebody by hand is the one path in this product with no automatic
   * justification behind it.
   */
  readonly reason: string;
}

// --- Referrals -------------------------------------------------------------

/** One row of `GET /api/admin/referrals`. */
export interface AdminReferralEarningListItem {
  readonly id: string;
  readonly referrerTelegramId: number;
  readonly referrerUsername: string;
  readonly referredTelegramId: number;
  readonly referredUsername: string;
  /** USDT cents paid out. */
  readonly amount: number;
  /** UAH kopecks the payout was computed from. */
  readonly fiatAmount: number;
  readonly exchangeRate: number;
  readonly ratePercent: number;
  readonly createdAt: string;
}

// --- Terminals -------------------------------------------------------------

/** One row of `GET /api/admin/terminals`. */
export interface AdminTerminalListItem {
  readonly id: string;
  readonly traderId: number;
  readonly cardId: number;
  readonly terminalId: number | null;
  readonly terminalName: string;
  readonly source: TerminalSource;
  readonly bankProvider: BankProvider | null;
  readonly url: string | null;
  readonly enabled: boolean;
  readonly acceptingOrders: boolean;
  /** UAH kopecks, last observed. `null` when never scraped. */
  readonly lastBalance: number | null;
  readonly lastGoal: number | null;
  readonly lastBalanceAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * `POST /api/admin/terminals/:id/state`.
 *
 * Both flags are optional so one can be moved without restating the other —
 * they answer different questions and an operator rarely means both at once.
 */
export interface AdminSetTerminalStateReq {
  readonly enabled?: boolean;
  readonly acceptingOrders?: boolean;
  readonly reason: string;
}

/**
 * One row of `GET /api/admin/terminals/:cardId/history`.
 *
 * **The whole stored record, not a projection of it.** The panel renders this
 * through `@transacto/history-table`, the same component the extension uses,
 * and that component reads `executionReason` to choose an order badge's label
 * and colour. A narrower shape here — which is what this was — silently
 * downgraded every matched order to the generic badge, so the two screens
 * showed different things for the same scrape.
 *
 * `timestamp` is ISO-8601 rather than a `Date`, because that is what JSON
 * carries; the table accepts either.
 */
export interface AdminTerminalHistoryItem extends Omit<TerminalHistory, '_id' | 'timestamp'> {
  readonly id: string;
  readonly timestamp: string;
}

// --- Transacto orders ------------------------------------------------------

/** One row of `GET /api/admin/orders`. */
export interface AdminOrderListItem {
  readonly id: string;
  readonly orderId: number;
  readonly orderStringId: string;
  readonly traderId: number;
  readonly cardId: number;
  /** UAH kopecks. */
  readonly amount: number;
  readonly actualAmount: number | null;
  readonly status: OrderStatus;
  readonly executionReason: string | null;
  readonly awaitingUpstreamConfirmation: boolean;
  readonly enqueuedAt: string;
  readonly lastSyncAt: string;
  readonly createdAt: string;
}

// --- Traders ---------------------------------------------------------------

/**
 * One row of `GET /api/admin/traders`.
 *
 * There is no `apiToken` here and there must never be: it is the credential the
 * extension authenticates with, and a panel that lists it turns read access to
 * the admin UI into full impersonation of every trader.
 */
export interface AdminTraderListItem {
  readonly id: string;
  readonly traderId: number;
  readonly isActive: boolean;
  readonly terminalsTotal: number;
  readonly terminalsEnabled: number;
  readonly pendingAlerts: number;
  readonly createdAt: string;
}

/** `POST /api/admin/traders/:traderId/active`. */
export interface AdminSetTraderActiveReq {
  readonly isActive: boolean;
  readonly reason: string;
}

// --- Alerts & safe box -----------------------------------------------------

/** One row of `GET /api/admin/alerts`. */
export interface AdminAlertListItem {
  readonly id: string;
  readonly traderId: number;
  readonly terminalId: number;
  readonly type: AlertType;
  readonly status: AlertStatus;
  /** UAH kopecks. */
  readonly amount: number;
  readonly isRead: boolean;
  /**
   * The translation parameters for `type`.
   *
   * Carried through untouched: the panel renders `'ALERTS.' + type` with these
   * as its arguments, the same way the extension does, so neither side stores a
   * rendered sentence.
   */
  readonly metadata: AlertMetadata | null;
  readonly createdAt: string;
}

/**
 * `POST /api/admin/alerts/:id/resolve` and `DELETE /api/admin/alerts/:id`.
 *
 * Deleting is permanent. An alert records a discrepancy in somebody's money, so
 * the row's whole content is copied onto the audit entry on the way out — the
 * list loses it, the trail does not.
 */
export interface AdminAlertActionReq {
  readonly reason: string;
}

/** One row of `GET /api/admin/safe-box`. */
export interface AdminSafeBoxListItem {
  readonly id: string;
  readonly traderId: number;
  readonly terminalId: number;
  /** UAH kopecks. */
  readonly amount: number;
  readonly originalDelta: number | null;
  readonly status: string;
  readonly comment: string | null;
  readonly linkedOrderId: number | null;
  readonly alertCreatedAt: string;
  readonly createdAt: string;
}

// --- Support ---------------------------------------------------------------

/** One row of `GET /api/admin/support/topics`. */
export interface AdminSupportTopicListItem {
  readonly id: string;
  readonly telegramId: number;
  /** Telegram's `message_thread_id` for this conversation inside the support group. */
  readonly messageThreadId: number;
  /** The user's name as the topic title spells it. */
  readonly displayName: string;
  readonly status: SupportTopicStatus;
  readonly lastUserMessageAt: string | null;
  readonly lastAdminMessageAt: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One row of `GET /api/admin/support/users`.
 *
 * Everyone who has ever written to the bot, which is deliberately not the same
 * set as the Mini App's users: someone can message the bot without ever opening
 * the app, so `telegramId` is a join key here and never a foreign key.
 */
export interface AdminSupportUserListItem {
  readonly id: string;
  readonly telegramId: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string;
  /** Telegram's own IETF tag as last seen — the client's guess at their language. */
  readonly languageCode: string;
  /** The language they picked by hand, which outranks the tag above. */
  readonly preferredLocale: SupportLocale | null;
  readonly lastSeenAt: string | null;
  /** Whether this Telegram id also has a Mini App account. */
  readonly hasTmaAccount: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// --- Audit -----------------------------------------------------------------

/**
 * One row of `GET /api/admin/audit`.
 *
 * A key plus its parameters, never a rendered sentence — the same rule the rest
 * of the system follows. `metadata` carries everything the panel interpolates
 * into `'AUDIT.' + action`.
 */
export interface AdminAuditLogItem {
  readonly id: string;
  readonly actor: string;
  readonly action: AdminAuditAction;
  readonly targetType: AdminAuditTargetType;
  /** The Telegram id, order id, card id or trader id the action was about. */
  readonly targetId: string;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly ip: string | null;
  readonly createdAt: string;
}

// --- Realtime payloads -----------------------------------------------------

/**
 * Every admin push carries the whole row it concerns, not a delta.
 *
 * The panel replaces the entity in its store rather than merging fields into
 * it, which makes a message missed during a reconnect self-healing instead of a
 * permanent hole — the same choice the Mini App's progress stream made, and for
 * the same reason.
 */
export interface AdminUserUpdatedEvent {
  readonly user: AdminTmaUserListItem;
}

export interface AdminSaleUpdatedEvent {
  readonly order: AdminSaleListItem;
}

/** Payload of {@link AdminWsEventNames.FIAT_DEPOSIT_UPDATED}. */
export interface AdminFiatDepositUpdatedEvent {
  readonly fiatDeposit: AdminFiatDepositListItem;
}

export interface AdminDepositUpdatedEvent {
  readonly deposit: AdminDepositListItem;
}

export interface AdminTerminalUpdatedEvent {
  readonly terminal: AdminTerminalListItem;
}

export interface AdminAlertUpdatedEvent {
  readonly alert: AdminAlertListItem;
}

export interface AdminAuditLoggedEvent {
  readonly entry: AdminAuditLogItem;
}

/**
 * A counter moved.
 *
 * Sent instead of a fresh {@link AdminOverviewRes} on every write: the overview
 * is several aggregations across four collections, and recomputing it because
 * one deposit changed status would put that cost on the write path. The panel
 * holds the last snapshot and applies these, and re-fetches when the screen is
 * opened.
 */
export interface AdminOverviewDeltaEvent {
  /** Dotted path into {@link AdminOverviewRes}, e.g. `deposits.pending`. */
  readonly path: string;
  readonly delta: number;
}
