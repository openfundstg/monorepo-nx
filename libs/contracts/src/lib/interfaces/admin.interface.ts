import type {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminBalanceOperation,
  AdminBalanceTarget,
  AdminAmountCurrency,
  AdminDepositKind,
  AdminDocumentKind,
  AdminFiatDepositAction,
  AdminSaleAction,
  AdminSaleFilter,
  AdminSortDirection,
} from '../enums/admin.enum.js';
import type { AlertStatus, AlertType } from '../enums/alert.enum.js';
import type { BankProvider } from '../enums/bank-provider.enum.js';
import type { OrderStatus } from '../enums/order-status.enum.js';
import type { TerminalSource } from '../enums/terminal-source.enum.js';
import type {
  SaleBlockReason,
  SaleCardOrderState,
  SaleEventType,
  SaleEvidence,
  SaleMethod,
  SaleReceiverNameSource,
  SaleRemainderPolicy,
  SaleStatementRejection,
  SaleStatementStatus,
  TmaDepositStatus,
  TmaSaleStatus,
  TrustLevel,
} from '../enums/tma.enum.js';
import type {
  FiatDepositWatchMode,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus,
} from '../enums/fiat-deposit.enum.js';
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
  /**
   * The one named slice a list offers, as that list's own enum spells it.
   *
   * A single string rather than a filter object, because every list that has
   * more than one slice has exactly one *axis* of them — the sales book is cut
   * by method, the deposits book by rail, the archive by document — and an
   * operator picks one chip. The narrowed request types below say which enum
   * each list reads it as, and the backend validates against that enum rather
   * than against this field.
   *
   * Absent means the whole list. It is never an empty string: an empty filter
   * that matched nothing is the bug this is documented to prevent.
   */
  readonly filter?: string;
}

/**
 * The narrowing the two books share.
 *
 * **Every amount here is in the base unit** — kopecks for hryvnia, cents for
 * USDT — like every other figure on this wire. The form a person types into
 * deals in hryvnia and USDT and converts once, on the way out; a range that
 * travelled in human units would be the one place in the product where a
 * number means something different from everywhere else.
 */
export interface AdminBookFilters {
  /** ISO date. Inclusive, from the start of that day in the server's timezone. */
  readonly from?: string;
  /** ISO date. Inclusive, to the end of that day. */
  readonly to?: string;
  /**
   * Which figure the range below applies to.
   *
   * A sale has a hryvnia target and a USDT stake, and a deposit has a hryvnia
   * amount and the USDT it credits. They are different questions — "sales over
   * ₴5 000" and "sales staking over 100 USDT" — and a single amount field
   * would have to pick one and be wrong for the other half of the time.
   */
  readonly currency?: AdminAmountCurrency;
  /** Base units of {@link currency}. Inclusive. */
  readonly minAmount?: number;
  readonly maxAmount?: number;
  /** One status, as that list's own enum spells it. */
  readonly status?: string;
  /** Whose rows to show. */
  readonly telegramId?: number;
}

/** `GET /api/admin/sales`, whose slice is {@link AdminSaleFilter}. */
export interface AdminSalesPageReq extends AdminPageReq, AdminBookFilters {
  readonly filter?: AdminSaleFilter;
}

/** `GET /api/admin/deposits`, whose slice is {@link AdminDepositKind}. */
export interface AdminDepositsPageReq extends AdminPageReq, AdminBookFilters {
  readonly filter?: AdminDepositKind;
}

/** `GET /api/admin/documents`, whose slice is {@link AdminDocumentKind}. */
export interface AdminDocumentsPageReq extends AdminPageReq {
  readonly filter?: AdminDocumentKind;
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
    /**
     * Card orders waiting on a person — denied, or proven unpaid.
     *
     * On the landing screen because it is the one queue in this product that
     * only a human empties: nothing in the codebase closes an appeal, by
     * deliberate decision. It had a sidebar entry of its own for exactly that
     * reason, and folding that entry into the sales book would have hidden the
     * count unless it surfaced here.
     */
    readonly disputed: number;
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
  /**
   * Which of the two sales this is.
   *
   * On the wire because the book is now one list rather than two screens: a jar
   * sale and a card sale are read completely differently — one is watched by
   * the scraper and settles itself, the other waits on the seller's word — and
   * a row that does not say which invites both to be read as the first.
   */
  readonly saleMethod: SaleMethod;
  /**
   * Whether the name on this sale's terminal is what the seller typed or what a
   * bank said.
   *
   * A card sale has no drop link to vouch for its destination, so until a
   * statement is accepted the name is only a form field — and that difference
   * is the whole of what an operator is judging in a dispute. The name itself is
   * not on this row: the sale keeps none, and the terminal in Transacto's panel
   * — `TMA-` plus {@link publicId} — is where it is read.
   */
  readonly receiverNameSource: SaleReceiverNameSource;
  /**
   * The card order this sale is currently answering for, or `null`.
   *
   * The open one — denied, or proven unpaid, or still waiting on the seller —
   * and the oldest of them if a credential's one-at-a-time cap ever slips
   * upstream. `null` on every jar sale and on a card sale with nothing
   * outstanding.
   *
   * Carried on the row so the dispute queue is a *filter* of this list rather
   * than a screen of its own. It was a screen of its own, and the cost was that
   * an operator holding a Transacto order number could reach the dispute but
   * not the sale around it.
   */
  readonly cardOrder: AdminSaleCardOrderSummary | null;
  /** How many card orders this sale has taken, open and settled. */
  readonly cardOrdersTotal: number;
  /** Statements uploaded across every one of them — see the archive. */
  readonly statementCount: number;
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
 * The card order a sale is answering for, as its row carries it.
 *
 * A summary and not the order: the statements themselves are documents about
 * somebody's bank account, and they belong on the sale's own page and in the
 * archive rather than in a table an operator scans. What a row needs is the
 * number they arrived holding, what was denied, and how long it has waited.
 */
export interface AdminSaleCardOrderSummary {
  /** Transacto's numeric order id — what an operator arrives from their panel with. */
  readonly orderId: number;
  readonly state: SaleCardOrderState;
  /** UAH kopecks the payer was routed to send. */
  readonly amount: number;
  /**
   * What the seller says actually landed, in UAH kopecks, or `null`.
   *
   * Present and smaller than {@link amount} when a transfer fee took a bite out
   * of it. Kept beside the amount rather than replacing it, because the two are
   * different facts and their disagreement is the thing worth seeing.
   */
  readonly declaredAmount: number | null;
  /**
   * What a bank statement showed for this order's window, in UAH kopecks, or
   * `null` where no document has contradicted the seller.
   *
   * The half of a dispute an operator cannot reconstruct from anywhere else:
   * `declaredAmount` is what they claimed, this is what their own bank shows,
   * and the sale's total has already moved to the second.
   */
  readonly provenAmount: number | null;
  readonly arrivedAt: string;
  readonly confirmDeadlineAt: string;
  readonly answeredAt: string | null;
  readonly statementCount: number;
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

/**
 * Payload of {@link AdminWsEventNames.FIAT_DEPOSIT_UPDATED} and of
 * {@link AdminWsEventNames.DEPOSIT_UPDATED} — the same shape, deliberately.
 *
 * Two event names because two different things in the product move, and the
 * panel wants to know which without inspecting the row. One payload because
 * the panel shows both rails in one book, and a push that arrived in a shape
 * the list does not hold would have to be converted by the client — which is
 * the second projection of a deposit this design exists to avoid.
 */
export interface AdminDepositUpdatedEvent {
  readonly deposit: AdminDepositRowItem;
}

/** @deprecated Use {@link AdminDepositUpdatedEvent}; both events carry it now. */
export type AdminFiatDepositUpdatedEvent = AdminDepositUpdatedEvent;

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


// --- The document archive --------------------------------------------------

/**
 * One document this product holds or once held, whatever it is evidence of.
 *
 * **Every file that passes through here is in this list**, which is the point
 * of the list: a statement a seller sent to disprove a payment and a receipt a
 * payer sent to prove one are answered in completely different places, and an
 * operator who has been handed a file has no way to know which of the two they
 * are looking at until something tells them. {@link kind} tells them, and the
 * reference fields below turn the document back into the thing it is about.
 *
 * **Exactly one pair of references is populated per kind.** A statement names
 * its sale and the Transacto order it answers; a receipt names its top-up and
 * the Transacto payout it pays. Nothing here cross-references the other kind,
 * because nothing in the product does.
 *
 * **No account numbers, in any form.** A statement's account tail and a
 * receipt's recipient card are payment credentials, and a list rendered in a
 * browser is not where either belongs. What a row carries is who, how much,
 * which bank and what verdict — the document itself is one click away for the
 * cases where more is genuinely needed.
 */
export interface AdminDocumentListItem {
  /** The document's own id — a statement's, or a receipt's. Unique within its kind. */
  readonly id: string;
  readonly kind: AdminDocumentKind;
  readonly telegramId: number;
  readonly username: string;
  /**
   * Whose format it was read with, or `null` when nothing has read it yet.
   *
   * A statement always names one, because the upload had to pick a reader. A
   * receipt names the bank whose signature vouched for it, which is `null` for
   * one that was refused before any bank was reached.
   */
  readonly bank: BankProvider | null;
  /**
   * The verdict, as its own kind's enum spells it.
   *
   * Two enums in one field, discriminated by {@link kind} — and the client
   * builds its translation key from both, exactly as it does everywhere else.
   * Flattening them into a third enum would mean a status that is written down
   * in three places and agrees in two.
   */
  readonly status: SaleStatementStatus | TmaFiatReceiptStatus;
  readonly rejection: SaleStatementRejection | TmaFiatReceiptRejection | null;
  /**
   * UAH kopecks the document is held to state, or `null`.
   *
   * For a receipt this is the figure *Transacto* recognised, never one we read
   * — coverage is counted in what the counterparty acknowledged. A statement
   * states no single sum, so it is `null` there.
   */
  readonly amountUah: number | null;
  /** As uploaded. `null` for a record whose file this product never held. */
  readonly sizeBytes: number | null;
  readonly uploadedAt: string;
  /**
   * When the bytes were deleted, or `null` while they are still on disk.
   *
   * **The record outlives the document, deliberately.** What a dispute was
   * settled on stays forever; somebody's whole transaction history has no
   * business doing the same. A row with this set says the document existed and
   * is gone, which is a different fact from never having existed.
   */
  readonly purgedAt: string | null;
  /** Whether this panel can serve the bytes right now. */
  readonly fileAvailable: boolean;
  /**
   * Where the counterparty filed their own copy, for a receipt they accepted.
   *
   * Read back off Transacto's checks table. Always `null` for a statement —
   * nobody downstream ever sees one.
   */
  readonly externalUrl: string | null;

  // --- what it is about ----------------------------------------------------

  /** The sale a statement answers for. `null` on a receipt. */
  readonly saleId: string | null;
  /** That sale's public code — what the seller quotes to support. */
  readonly salePublicId: string | null;
  /** The Transacto order a statement answers. `null` on a receipt. */
  readonly cardOrderId: number | null;
  /** The top-up a receipt pays. `null` on a statement. */
  readonly fiatDepositId: string | null;
  /** The Transacto payout that top-up is settling. `null` on a statement. */
  readonly payoutId: number | null;

  // --- what it says --------------------------------------------------------

  /**
   * The period a statement covers, once it has been read.
   *
   * The pair that decides whether it is evidence at all: a statement proves a
   * *negative*, and one whose period does not contain the whole time the order
   * was open proves nothing about the part it misses. Both `null` until it has
   * been parsed, and a `null` here can never be read as "covers everything".
   */
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /**
   * The account holder as the bank states them, on a statement.
   *
   * The one field worth an operator's eye on its own: a name here that is not
   * the one the seller declared means money went to a card whose holder they
   * described wrongly.
   */
  readonly ownerName: string | null;
  /**
   * Whether a receipt's recipient was actually compared with the payout's card.
   *
   * `false` on one combination only — a PrivatBank transfer that stayed inside
   * PrivatBank, whose document names an IBAN rather than a card, against a
   * payout whose recipient name is empty. Nothing on either side is comparable,
   * so the receipt went up on the strength of the other three checks. `null` on
   * a statement, where the question does not arise.
   */
  readonly recipientChecked: boolean | null;
}

/** One uploaded statement, as the panel lists it under its sale. */
export interface AdminSaleStatement {
  readonly id: string;
  readonly bank: BankProvider;
  readonly status: SaleStatementStatus;
  readonly rejection: SaleStatementRejection | null;
  readonly uploadedAt: string;
  readonly sizeBytes: number;
  readonly purgedAt: string | null;
  readonly fileAvailable: boolean;
  /** What the document says it covers, once it has been read. */
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /** The account holder as the bank states them — see {@link AdminDocumentListItem.ownerName}. */
  readonly ownerName: string | null;
}

// --- Sale detail -----------------------------------------------------------

/** One card order of a sale, with the documents sent about it. */
export interface AdminSaleCardOrder extends AdminSaleCardOrderSummary {
  readonly statements: readonly AdminSaleStatement[];
}

/**
 * One thing that happened to a card sale, and who says so.
 *
 * **The card variant's answer to the jar's scraping history**, and deliberately
 * not the same shape. A jar row is an observation — the bank was asked what the
 * balance was — so it carries balances and deltas. Nobody can ask a seller's
 * own card anything, so a card sale's row carries an assertion and the thing
 * that later backed it up.
 *
 * Rendered as `'SALE_EVENT.' + type`, with {@link metadata} supplying whatever
 * the sentence interpolates — the same rule as everywhere else, so nothing here
 * is a stored sentence.
 */
export interface AdminSaleHistoryItem {
  readonly id: string;
  /** Transacto's order number this concerns, or `null` for a sale-wide event. */
  readonly orderId: number | null;
  readonly type: SaleEventType;
  /**
   * Whose word this stands on.
   *
   * `null` on every entry written before this was recorded — read as unknown
   * rather than as any particular answer, because nobody wrote one down and
   * picking one now would invent a fact about somebody's money.
   */
  readonly evidence: SaleEvidence | null;
  /** UAH kopecks the event is about, where it is about a sum. */
  readonly amount: number | null;
  readonly at: string;
  /**
   * The statement this entry is *about* — set on the statement events
   * themselves, so the row can link to the document.
   */
  readonly statementId: string | null;
  /**
   * The statement that later vouched for this entry, or `null`.
   *
   * **This is the checkpoint.** An accepted statement covers a period, and
   * everything the seller asserted inside it is settled by the document rather
   * than by their word — recorded here after the fact, on entries that were
   * written long before. A `SELLER` row with this empty is a claim nobody has
   * corroborated yet, which is exactly what an operator needs to see.
   */
  readonly corroboratedBy: string | null;
  readonly corroboratedAt: string | null;
  /** Everything `'SALE_EVENT.' + type` interpolates. Never a rendered sentence. */
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

/**
 * `GET /api/admin/sales/:id` — one sale and everything attached to it.
 *
 * **Assembled here rather than linked to.** An operator working a complaint
 * needs the seller, the terminal the money was routed through, the Transacto
 * orders that executed against it and the documents sent about it — and every
 * one of those was a separate screen, reached by copying an id out of a table.
 * The counters and the embedded rows are read fresh, so this page cannot
 * contradict the lists it links to.
 */
export interface AdminSaleDetailRes {
  readonly sale: AdminSaleListItem;
  /** `null` only if the account has since been removed, which nothing does today. */
  readonly user: AdminTmaUserListItem | null;
  /** Empty on a jar sale, which takes no card orders. */
  readonly cardOrders: readonly AdminSaleCardOrder[];
  /**
   * The Transacto orders routed at this sale's terminal, newest first.
   *
   * Capped — the full book has its own list, filtered by the same terminal.
   */
  readonly transactoOrders: readonly AdminOrderListItem[];
  /** The terminal the sale is bound to, or `null` before one is assigned. */
  readonly terminal: AdminTerminalListItem | null;
  /** Every document sent about this sale, newest first. */
  readonly documents: readonly AdminDocumentListItem[];
  /**
   * What happened to this sale, oldest first.
   *
   * The sale's own timeline — the same one the seller is shown in the Mini App,
   * plus the entries that are an operator's business and not theirs. On a jar
   * sale these are the scraper's observations; on a card sale they are
   * assertions and whatever later corroborated them, which is a difference
   * {@link AdminSaleHistoryItem.evidence} exists to make legible.
   *
   * Oldest first because it is read as a story rather than scanned as a book —
   * the opposite of every list in this panel, and deliberately.
   */
  readonly history: readonly AdminSaleHistoryItem[];
}

// --- The deposits book -----------------------------------------------------

/**
 * One way money came in, whichever rail it came over.
 *
 * **Both rails in one row shape, and the money in one unit each.** A crypto
 * deposit stores whole USDT and a fiat top-up stores USDT cents; a row carrying
 * whichever the source happened to use would be a hundredfold error that no
 * type catches, because both are `number`. So {@link cryptoCents} is cents on
 * every row, converted once at the boundary, and nothing downstream has to know
 * which collection the row came from.
 *
 * What is *not* here is the recipient card. It is a payment credential, it is
 * only ever needed for the one errand of reconciling a top-up against
 * Transacto's own panel, and that errand has a page — see
 * {@link AdminDepositDetailRes}.
 */
export interface AdminDepositRowItem {
  readonly id: string;
  readonly kind: AdminDepositKind;
  readonly telegramId: number;
  readonly username: string;
  /** USDT cents credited, or to be credited. Cents on both rails — see above. */
  readonly cryptoCents: number;
  /**
   * UAH kopecks: the payout's amount on a fiat top-up, the snapshotted fiat
   * equivalent on a crypto deposit.
   */
  readonly fiatAmount: number;
  /** Kopecks per 1 USDT, snapshotted when the deposit was created. */
  readonly exchangeRate: number;
  /**
   * The status, as its own rail's enum spells it — discriminated by
   * {@link kind}, for the reason {@link AdminDocumentListItem.status} gives.
   */
  readonly status: TmaDepositStatus | TmaFiatDepositStatus;
  /**
   * UAH kopecks proven so far, on a fiat top-up. `null` on a crypto deposit,
   * which is not paid in parts.
   */
  readonly coveredUah: number | null;
  /** Documents sent about this deposit. Always `0` on a crypto deposit. */
  readonly documentCount: number;
  /** Of those, the ones that were accepted. */
  readonly acceptedDocumentCount: number;
  /**
   * Which bank the hryvnia came from, once a receipt has said so.
   *
   * The accepted receipt's bank where there is one, otherwise the last receipt
   * that named a bank at all — a refused receipt still says where the payer
   * banks, which is the fact an operator is usually after. `null` on a crypto
   * deposit, which has no bank, and on a top-up nobody has sent a receipt for.
   *
   * Carried so the book can be read by bank at a glance. It decides who can be
   * asked about a payment and what document could prove it.
   */
  readonly bank: BankProvider | null;
  /** Transacto's payout id on a fiat top-up, `null` on a crypto deposit. */
  readonly payoutId: number | null;
  /** The chain transaction on a crypto deposit, `null` on a fiat top-up. */
  readonly txId: string | null;
  /** When the on-screen timer runs out — the pay deadline, or the expiry. */
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/**
 * `GET /api/admin/deposits/:kind/:id` — one deposit and what settled it.
 *
 * Addressed by kind and id because the two ids come from different collections
 * and nothing guarantees they do not collide.
 */
export interface AdminDepositDetailRes {
  readonly deposit: AdminDepositRowItem;
  readonly user: AdminTmaUserListItem | null;
  /** Receipts sent against a fiat top-up, newest first. Empty on a crypto deposit. */
  readonly documents: readonly AdminDocumentListItem[];
  /**
   * The card the payer was told to transfer to, in full, on a fiat top-up.
   *
   * **In full and deliberately.** An operator reconciling one of these is
   * looking at the same payout in Transacto's own panel, and a masked number
   * cannot be matched against anything — which is the whole task. It is on this
   * page rather than in the list for the same reason it is never logged: one
   * errand needs it, and a table nobody reads it from is not that errand.
   */
  readonly recipientCard: string | null;
  /** When we stop holding the payout, on a fiat top-up. */
  readonly holdUntilAt: string | null;
}
