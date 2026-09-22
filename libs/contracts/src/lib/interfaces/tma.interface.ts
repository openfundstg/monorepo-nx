import type {
  TrustLevel,
  TmaDepositStatus,
  TmaSaleStatus,
  SaleEventType,
  SaleBlockReason,
  SaleRemainderPolicy,
  SaleMethod,
  SaleCardOrderState,
  SaleReceiverNameSource,
  SaleStatementStatus,
  SaleStatementRejection,
} from '../enums/tma.enum.js';
import type { BankProvider } from '../enums/bank-provider.enum.js';
import type { TmaFiatDepositStatus } from '../enums/fiat-deposit.enum.js';
import type { BalanceEntryKind } from '../enums/balance.enum.js';

// --- User ------------------------------------------------------------------

export interface TmaUser {
  telegramId: number;
  firstName: string;
  lastName: string;
  username: string;
  balance: number;
  frozenBalance: number;
  totalTurnover: number;
  isActive: boolean;
  /**
   * Referral earnings, in USDT cents.
   *
   * A separate pot from {@link balance}: it cannot fund a sale and
   * cannot be withdrawn — the only operation on it is transferring it across to
   * {@link balance}, the way bank cashback works. Carried on the profile so the
   * nav badge and the referral page agree without a second request.
   */
  referralBalance: number;
  /** Lifetime referral earnings in USDT cents, including transfers already made. */
  totalReferralEarned: number;
  /**
   * Whether this user's name is shown to whoever invited them. Off by default —
   * a referrer sees a masked id until the referral opts in.
   */
  showNameToReferrer: boolean;
}

export interface TrustLevelInfo {
  level: TrustLevel;
  /**
   * How many sales this level may have running at once.
   *
   * The only thing a trust level now controls. It used to cap the *size* of a
   * single order in USDT, which bounded nothing that mattered — an order is
   * already bounded by the balance staked against it — while a user running
   * ten small orders at once was unrestricted.
   */
  maxParallelOrders: number;
}

/** One rung of the trust ladder, as `GET /api/tma/trust-levels` reports it. */
export interface TrustLevelRung {
  level: TrustLevel;
  /** Lifetime turnover this rung starts at, in UAH kopecks. */
  minTurnover: number;
  /** How many sales it allows at once. */
  maxParallelOrders: number;
}

/**
 * The whole ladder, cheapest rung first.
 *
 * Served rather than duplicated on the client. The Mini App used to carry its
 * own copy of the turnover milestones with a comment asking whoever changed the
 * backend to remember this file too — which is a drift waiting to happen, and
 * would show a user as half-way to a level they already hold.
 */
export interface TrustLevelLadderResponse {
  levels: TrustLevelRung[];
}

export interface AuthResponse {
  user: TmaUser;
  trustLevel: TrustLevelInfo;
  isNewUser: boolean;
}

export interface UserProfileResponse {
  user: TmaUser;
  trustLevel: TrustLevel;
  /**
   * The level's allowances, flattened.
   *
   * `/auth` returns the composed {@link TrustLevelInfo}; this endpoint predates
   * it and spells the same figures out. Both are needed — the two endpoints
   * answer different questions — but every allowance the ladder grants must
   * appear on both, or a client that refreshed its profile would find an
   * allowance it was told about at launch had quietly gone missing.
   */
  maxParallelOrders: number;
  /**
   * Finished sales whose jars are still open, and still holding a slot.
   *
   * The same rows {@link SaleConfigResponse} carries, on the endpoint the
   * dashboard already loads. Both need them and neither can borrow the other's
   * call: the create form must refuse before a round trip, and the dashboard is
   * where a user finds out at all — a person who is not currently trying to
   * start a sale never opens the form that would tell them.
   */
  slotsAwaitingJarClosure: readonly SaleAwaitingJar[];
}

// --- Deposits --------------------------------------------------------------

export interface TmaDeposit {
  _id: string;
  telegramId: number;
  cryptoAmount: number;
  fiatEquivalent: number;
  exchangeRate: number;
  status: TmaDepositStatus;
  txId: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface DepositConfigResponse {
  walletAddress: string;
  exchangeRate: number;
  expiryMinutes: number;
}

export interface CreateDepositResponse {
  depositId: string;
  cryptoAmount: number;
  fiatEquivalent: number;
  exchangeRate: number;
  walletAddress: string;
  expiresAt: string;
  status: TmaDepositStatus;
}

export interface VerifyTxResponse {
  success: boolean;
  status: TmaDepositStatus;
  balanceCredited?: number;
}

// --- Sales ---------------------------------------------------------

export interface TmaSale {
  _id: string;
  /**
   * Human-readable identifier, digits and uppercase letters (e.g. `Z38SL69F`).
   *
   * This is the code the user sees and quotes to support, and the code the
   * Transacto terminal is named after (`TMA-<publicId>`). It is display and
   * correlation only — `_id` remains the key for routes and realtime payloads.
   */
  publicId: string;
  telegramId: number;
  /**
   * Where this sale delivers its hryvnia, and therefore what proves it arrived.
   *
   * Optional because the document is returned as it is stored, and sales written
   * before the variant existed carry no value — Mongoose defaults are not
   * applied to a lean read. Absent means {@link SaleMethod.JAR}, which is what
   * every one of them was. The backfill migration writes it explicitly rather
   * than leaving readers to remember that.
   */
  saleMethod?: SaleMethod;
  fiatAmount: number;
  /**
   * Kopecks per USDT **for this sale**, snapshotted when it was created.
   *
   * The finished sell rate — the market's part and the markup are already
   * inside it, and neither is recorded anywhere. It is what the user was quoted,
   * what their stake was taken at, and what every settlement converts with, so
   * a sale is priced once and cannot be repriced by anything that happens to it
   * afterwards.
   *
   * It used to hold the *market* rate with a `profitPercent` beside it, and
   * every reader had to remember to combine them. Most did; the partial
   * settlement did not, and charged users their delivered hryvnia at the market
   * instead of at the rate they sold at.
   */
  exchangeRate: number;
  /** USDT **cents** frozen for this order — what the user spent to run it. */
  frozenUsdt: number;
  bankType: string;
  dropLink: string;
  status: TmaSaleStatus;
  transactoTerminalId: number | null;
  cardId: number | null;
  /** UAH kopecks matched and executed on the terminal so far. */
  receivedAmount: number;
  /**
   * What happens to a tail no payment can cover, as chosen at creation.
   *
   * Optional because the document is returned as it is stored, and orders
   * written before the choice existed carry no value — Mongoose defaults are
   * not applied to a lean read. Absent means
   * {@link SaleRemainderPolicy.WAIT_FOR_TOP_UP}.
   */
  remainderPolicy?: SaleRemainderPolicy;
  /**
   * USDT cents handed back as the unfillable tail when the order completed.
   *
   * Zero on every order that filled its jar, and on every order that waited for
   * a top-up. `frozenUsdt` less this is what the order actually cost.
   */
  refundedRemainderUsdt?: number;
  /** The same tail in UAH kopecks, before it was converted at the order's rate. */
  refundedRemainderFiat?: number;
  /**
   * The name a payer sees as the recipient.
   *
   * On a {@link SaleMethod.JAR} sale it comes from the bank behind the link, or
   * from the seller's Telegram profile where the bank says nothing. On a
   * {@link SaleMethod.CARD} sale the seller types it, because nothing else can.
   * Either way it is unchecked until a statement rewrites it — see
   * {@link receiverNameSource}.
   */
  receiverName?: string | null;
  /** Which of those two wrote {@link receiverName}. */
  receiverNameSource?: SaleReceiverNameSource;
  /**
   * The last four digits of the card a {@link SaleMethod.CARD} sale pays out to.
   *
   * Four and not sixteen, deliberately — see `cardTail`. `null` on a jar sale,
   * whose destination is the drop link.
   */
  payoutCardTail?: string | null;
  /**
   * The Transacto orders of a {@link SaleMethod.CARD} sale, oldest first.
   *
   * At most `SALE_CARD_MAX_ORDERS` of them, and at most one awaiting an
   * answer at a time — the credential is created with `max_open_orders: 1`.
   * Absent on a jar sale, whose orders are matched rather than answered and so
   * appear only as timeline events.
   */
  cardOrders?: readonly SaleCardOrder[];
  completedAt: string | null;
  createdAt: string;
}

/**
 * One Transacto order of a card sale, as the seller has to answer it.
 *
 * The card variant's unit of work. A jar sale's orders are settled by the
 * scraper and never need naming to the user; these are questions put to a
 * person, so each one carries what it is for, how long there is to answer, and
 * what happened.
 */
export interface SaleCardOrder {
  /** Transacto's internal numeric id — the one `orders_execute` accepts. */
  readonly orderId: number;
  /** What the payer was routed to send, in UAH kopecks. */
  readonly amount: number;
  /**
   * What the seller says actually landed, in UAH kopecks.
   *
   * Absent on every order answered with a plain "it arrived", which means the
   * whole of {@link amount}. Present, and smaller, when a transfer fee took a
   * bite out of it on the way.
   *
   * **It is this figure that counts toward the target, not {@link amount}.** A
   * jar sale credits what the scraper saw the jar grow by, which is already net
   * of whatever the bank took; a card sale has no such witness, so the seller's
   * own figure stands in its place — and a sale that credited the ordered amount
   * would quietly charge the fee to the seller while telling them it had not.
   *
   * Which is also why it is the one field on this document a seller has a motive
   * to understate: a smaller credit leaves more of the target outstanding and
   * brings them more hryvnia for the same stake. That is what the statement
   * checkpoint exists to settle.
   */
  readonly declaredAmount?: number;
  readonly state: SaleCardOrderState;
  /** When it was routed here, ISO 8601. */
  readonly arrivedAt: string;
  /**
   * When an unanswered order becomes a dispute, ISO 8601.
   *
   * Ours, not Transacto's: their `deadline` is how long the *payer* has. This is
   * how long the seller has after that, and it is what the screen counts down.
   */
  readonly confirmDeadlineAt: string;
  /** When it was answered, ISO 8601, or `null` while it still stands open. */
  readonly answeredAt: string | null;
  /**
   * Statements uploaded against this order, oldest first.
   *
   * Empty until somebody denies something — there is nothing to prove before
   * that. More than one because a refused statement is an ordinary outcome: the
   * period was too short, the file was a screenshot, it was for another card.
   * Every attempt is kept rather than overwritten, because an operator working
   * a dispute wants the whole sequence.
   *
   * **The screen shows the last one's refusal and no earlier one.** Only the
   * last describes a document the seller still has any reason to think about,
   * and rendering the list put a refused upload's reason directly under the
   * verdict of the accepted statement that followed it.
   */
  readonly statements: readonly SaleStatement[];
}

/**
 * A bank statement uploaded to settle one disputed order.
 *
 * The file itself never reaches the Mini App: it is the user's own document, an
 * operator reads it, and a client has no use for the bytes. What crosses the
 * wire is the verdict and enough of the document to explain it.
 */
export interface SaleStatement {
  readonly id: string;
  readonly status: SaleStatementStatus;
  /** Why it proved nothing, or `null` while it still might. */
  readonly rejection: SaleStatementRejection | null;
  readonly uploadedAt: string;
  /** The period the document covers, ISO 8601, once it has been read. */
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}

/**
 * `GET /api/tma/rates` — every price the product quotes, in one answer.
 *
 * One endpoint rather than one per price, and one poll rather than one per
 * screen. There are two rates now — the market price and the discounted one a
 * hryvnia top-up is credited at — and fetching them separately would let the
 * dashboard and the top-up screen show figures read seconds apart, which is
 * exactly how a user comes to believe the app is quoting two different prices
 * for the same thing.
 *
 * Its own endpoint rather than a field on a feature's config, because a rate is
 * not a property of depositing or of selling: the dashboard shows it while
 * doing neither. The feature configs still carry theirs, and must — a quote has
 * to come back with the balance and limits it was computed against, in one
 * response, or the client can freeze a stake at a price the server never agreed
 * to.
 */
export interface TmaRatesResponse {
  /**
   * Kopecks per USDT when the user is acquiring USDT — the smaller number.
   *
   * Served finished rather than as a market figure and a discount the client
   * applies. The spread is a business rule; a copy of it in the Mini App would
   * be a second one, and the screen would go on advertising a figure the
   * backend had moved off.
   */
  buy: number;
  /**
   * Kopecks per USDT when the user is selling USDT — the larger number.
   *
   * The rate every sale is priced at, and the one the create form quotes,
   * stakes and validates against. It is snapshotted onto the order as
   * `exchangeRate`, so a sale settles at the price it was sold at however long
   * it runs.
   */
  sell: number;
}

/**
 * The body of `POST /tma/sales/:id/orders/:orderId/confirm`.
 *
 * Empty for the ordinary answer — the bot's inline key sends nothing at all,
 * because a keyboard cannot ask for a number — and an empty body means the
 * order's whole amount arrived.
 */
export interface ConfirmCardOrderReq {
  /**
   * What actually landed, in UAH kopecks, when it is not the whole order.
   *
   * Never more than the order: a transfer fee can only take money out of one.
   */
  receivedAmount?: number;
}

export interface SaleConfigResponse {
  trustLevel: TrustLevel;
  /** How many sales this user's trust level allows at once. */
  maxParallelOrders: number;
  /**
   * How many of those slots are taken right now.
   *
   * Sent so the create form can say "2 of 3" and refuse before a round trip,
   * rather than letting a user fill in a link, a card and an amount only to be
   * turned away on submit. Counted at the moment of the request, so it is a
   * snapshot: the server checks again, under a lock, when the order is created.
   *
   * Includes {@link slotsAwaitingJarClosure} — a finished sale whose jar is
   * still open holds a slot exactly as a running one does.
   */
  openOrders: number;
  /**
   * The finished sales among those, and the jars their users have to close.
   *
   * A sale ends; its jar does not. Until the bank reports the jar closed, money
   * can still land in it that no order will ever match — so the slot stays
   * taken, and this is the list of what is taking it.
   *
   * Sent as rows rather than a count because the count alone produces the worst
   * possible screen: "1 / 1 active" beside a user who is certain they have no
   * sale running, and a refusal telling them to "finish the current one". The
   * form has to be able to name which sale, and link to it.
   *
   * Empty on a user whose slots are all genuinely running.
   */
  slotsAwaitingJarClosure: readonly SaleAwaitingJar[];
  /**
   * Kopecks per USDT for a sale — the rate this form quotes, stakes and
   * validates against, and the one snapshotted onto the order it creates.
   *
   * The finished rate, not a market figure the form marks up. The form used to
   * be sent the market plus `sellMarkupPercent` and combine them itself, which
   * is two places holding one price and a client that knew the spread.
   */
  sellRate: number;
  /**
   * The caller's available balance in **USDT cents**, so the create form can
   * reject an over-balance amount before it costs a round trip.
   *
   * Available, not total: `freezeBalance` has already been subtracted, which is
   * the same figure the server checks `requiredUsdtCents` against.
   */
  balance: number;
  /**
   * The smallest order the payment pipeline will route, in UAH kopecks.
   *
   * Sent rather than assumed because it is configurable server-side, and the
   * create form has to *name* it: the remainder choice offers to return
   * "anything under ₴300", so a client quoting a figure the server no longer
   * uses would be describing a product that does not exist.
   *
   * Falls back to `DEFAULT_MIN_ORDER_KOPECKS` on a client old enough not to
   * read it, which is the same number the server defaults to.
   */
  minOrderKopecks: number;
}

/**
 * A finished sale still holding its slot because its jar is open.
 *
 * Deliberately not the whole order: the create form needs to say which sale and
 * which bank, and offer a way to open it. Anything more would be a second,
 * partial statement of the order shape.
 */
export interface SaleAwaitingJar {
  /** Opens the sale's own screen — the same id the dashboard's rows carry. */
  readonly id: string;
  /** The code the user sees on the sale, and quotes to support. */
  readonly publicId: string;
  /** Which bank's jar to go and close. */
  readonly bankType: BankProvider;
  /** When the sale ended, ISO 8601 — the client formats it. */
  readonly endedAt: string;
}

export interface CreateSaleResponse {
  saleId: string;
  /** See {@link TmaSale.publicId}. */
  publicId: string;
  status: TmaSaleStatus;
  transactoTerminalId: number | null;
  cardId: number | null;
  fiatAmount: number;
  bankType: string;
}

/**
 * `POST /sales/resolve-link` — turns whatever the user pasted into the
 * link the scraper can actually read.
 *
 * Exists because PUMB shares a moneybox as `mobile-app.pumb.ua/XXXX`, which
 * 301s to the `payhub.com.ua` page carrying the `box_id` the scraper needs.
 * The browser cannot follow that itself: `Location` on a cross-origin redirect
 * is not readable from JavaScript, so the hop has to happen server-side.
 */
export interface ResolveDropLinkReq {
  bankType: BankProvider;
  link: string;
}

/**
 * `POST /api/tma/sales` — creating a sale.
 *
 * Declared here rather than in the Mini App's api service, where it used to
 * live: it crosses the wire, so both sides must read one definition. The
 * backend DTO `implements` it and adds the `class-validator` decorators.
 */
export interface CreateSaleReq {
  /**
   * Which variant to create.
   *
   * Optional so a client that predates the choice keeps working exactly as it
   * did: a missing value is read as {@link SaleMethod.JAR}, which is the only
   * thing it could ever have meant.
   */
  saleMethod?: SaleMethod;
  /** The order total in UAH kopecks — the figure the user sets as the jar goal. */
  fiatAmount: number;
  bankType: BankProvider;
  /**
   * The jar to pay into.
   *
   * Required on a {@link SaleMethod.JAR} sale and meaningless on a
   * {@link SaleMethod.CARD} one, which pays a card directly and has no link to
   * resolve. Send an empty string, or omit it.
   */
  dropLink?: string;
  /** 16 digits, however the user typed them. */
  cardNumber: string;
  /**
   * Who the payer will see as the recipient.
   *
   * Required on a {@link SaleMethod.CARD} sale and ignored on a jar one, where
   * the bank names the jar's owner and a form field would only be a second,
   * worse answer. It is rewritten from the first accepted statement — see
   * {@link SaleReceiverNameSource}.
   */
  receiverName?: string;
  /**
   * Kopecks per USDT that `fiatAmount` was worked out at.
   *
   * The market moves while a form is being filled, and the target moves with
   * it. Sending the rate the user was quoted lets the server tell a stale
   * figure from a current one, rather than freezing a stake against a target
   * the jar can no longer reach.
   */
  quotedRate: number;
  /**
   * What to do with a tail no payment can cover.
   *
   * Optional so a client that predates the choice keeps behaving exactly as it
   * did: the server reads a missing value as
   * {@link SaleRemainderPolicy.WAIT_FOR_TOP_UP}, which is what every
   * order did before this existed.
   */
  remainderPolicy?: SaleRemainderPolicy;
}

export interface ResolveDropLinkRes {
  /** The link to submit. Identical to the input when it was already usable. */
  link: string;
  /** `true` when following redirects actually changed it — the UI says so. */
  resolved: boolean;
  /**
   * The card the drop actually pays into, when resolving revealed it.
   *
   * PrivatBank's envelope record names its own card, so the create form can
   * fill the field in and the server can refuse a mismatch — a link and a card
   * number that belong to different people used to be accepted, and only
   * surfaced three dead orders later as `ORDERS_EXPIRED`. `null` means "not
   * known", which is every other bank today.
   */
  cardNumber: string | null;
  /**
   * The card the drop pays into, as far as the bank will say — `53552800****0000`.
   *
   * PUMB publishes twelve of sixteen digits on a moneybox. That is not a card,
   * so it cannot be paid into and the field stays the user's to fill; it is
   * enough to refuse a card that *cannot* be the right one, at creation rather
   * than three dead orders later. `null` for every other bank, and whenever the
   * bank could not be reached.
   *
   * Matched with `matchesMaskedCard`, never by hand: how much a bank chooses to
   * reveal is theirs to change.
   */
  cardNumberMask: string | null;
  /**
   * The drop's owner as the bank reports them, masked.
   *
   * Both PrivatBank and Monobank name theirs, and each masks it its own way:
   * an envelope answers "Петренко І." — surname and an initial — and a jar
   * answers "Іван П." — first name and a surname initial. Neither is an
   * identifier and neither is normalised, because the difference is the bank's
   * and not ours to smooth over.
   *
   * Useful twice: it shows the user which account they are about to point at,
   * and it becomes the terminal's receiver name, which is what a payer is shown
   * as the person they are paying. PUMB names one too — "Іван П." on the
   * moneybox record. `null` whenever the bank could not be reached.
   */
  ownerName: string | null;
  /**
   * The jar's current target in UAH kopecks, when resolving happened to reveal
   * it, otherwise `null`.
   *
   * Monobank's resolution step returns the jar's whole record, goal included,
   * so the create form can tell the user their target is wrong *before* they
   * submit — rather than the order being blocked later, with their stake
   * already frozen. PrivatBank and PUMB report theirs from their own records;
   * a `null` here means "not known", never "no goal set".
   */
  goal: number | null;
}

// --- Balance history -------------------------------------------------------

/**
 * `GET /user/balance-history` merges deposits and sales into a single
 * timeline, newest first. Discriminated by `type`, so the client renders each
 * without guessing which fields are present.
 *
 * Fiat amounts are kopecks; `cryptoAmount` is whole USDT (the figure the user
 * typed on the deposit form), which is why the client renders it unscaled.
 */
interface BalanceHistoryEntryBase {
  id: string;
  amount: number;
  createdAt: string;
}

export interface DepositHistoryEntry extends BalanceHistoryEntryBase {
  type: 'deposit';
  status: TmaDepositStatus;
  cryptoAmount: number;
}

/**
 * A hryvnia top-up on the balance timeline.
 *
 * Its own kind rather than a `DepositHistoryEntry` with different fields. The
 * two look alike on screen and are nothing alike underneath: one is verified
 * against a chain and credits what the chain says, the other is settled by
 * paying somebody's payout and credits a figure frozen at reservation. Sharing
 * a type would mean a `status` union spanning two lifecycles, and every reader
 * narrowing it by hand.
 */
export interface FiatDepositHistoryEntry extends BalanceHistoryEntryBase {
  type: 'fiat_deposit';
  status: TmaFiatDepositStatus;
  /** USDT cents credited on completion — the figure frozen at reservation. */
  cryptoCents: number;
  /** UAH kopecks accepted so far, so a part-paid row reads as part-paid. */
  coveredUah: number;
}

export interface SaleHistoryEntry extends BalanceHistoryEntryBase {
  type: 'sale';
  status: TmaSaleStatus;
  /**
   * What the sale took out of the balance, in USDT cents.
   *
   * The headline figure of the row — a sale is a debit in USDT and a credit in
   * hryvnia, and the USDT is the side the balance above it is counted in. The
   * hryvnia rides along underneath as {@link BalanceHistoryEntryBase.amount}:
   * the target while the order runs, and once it completes what actually
   * arrived — the target less the tail it refunded.
   *
   * The stake less any tail handed back on completion. A cancellation's refund
   * is not recorded on the order — it is computed and paid, and nothing writes
   * it down — so a cancelled row states the stake, which is the most this sale
   * could have cost.
   */
  stakeUsdtCents: number;
  bankType: string;
  /** See {@link TmaSale.publicId}. */
  publicId: string;
  /**
   * How this order ends when the last stretch is too small to pay for.
   *
   * On the list so the two kinds are distinguishable without opening each one —
   * they behave differently enough at the end that "which one was this?" is a
   * question the history has to answer.
   *
   * Optional: orders created before the choice existed carry no value, and a
   * lean read applies no default.
   */
  remainderPolicy?: SaleRemainderPolicy;
}

/**
 * A movement of the balance that no process document explains.
 *
 * Read off the balance book (`BalanceEntryKind`), and only for the kinds that
 * are not already on the timeline as something else: a referral transfer and an
 * operator's correction. A deposit, a top-up and a sale each keep their
 * own row above, because a process the user can open is worth more to them than
 * the pair of arithmetic entries it books — a completed order alone would
 * arrive as a stake and a refund, which is true and unreadable.
 *
 * Deliberately without the `amount` the other three carry. Those are hryvnia
 * figures the user transferred or sold; this movement never had one, and
 * converting its USDT at today's rate would restate a past movement at a price
 * it never happened at.
 */
export interface BalanceMovementHistoryEntry {
  type: 'balance_movement';
  id: string;
  kind: BalanceEntryKind;
  /** Signed USDT cents: what the balance gained, or lost. */
  cryptoCents: number;
  createdAt: string;
}

export type BalanceHistoryEntry =
  | DepositHistoryEntry
  | FiatDepositHistoryEntry
  | SaleHistoryEntry
  | BalanceMovementHistoryEntry;

// --- Sale execution progress ---------------------------------------

/**
 * One entry in a sale's execution timeline.
 *
 * Key plus data, never a rendered sentence: `type` is the translation key and
 * the remaining fields are its parameters. The list is persisted on the order,
 * so a client that reconnects gets the same timeline it would have built from
 * the live stream.
 */
export interface SaleEvent {
  type: SaleEventType;
  /** UAH kopecks. Present on money events (`PAYMENT_MATCHED`, `ORDER_RECEIVED`). */
  amount?: number;
  /** Transacto's numeric order id, when the event is about a specific order. */
  orderId?: number;
  /** Epoch milliseconds. */
  at: number;
}

/**
 * Everything the status page renders, as one snapshot.
 *
 * `GET /sales/:id/progress` and the
 * {@link TmaWsEventNames.SALE_PROGRESS} push return the *same* shape on
 * purpose: the socket carries a complete state, not a delta, so the client
 * replaces rather than merges. That removes the dedupe problem the extension's
 * history feed still has, and makes a missed event during a reconnect
 * self-healing instead of a permanent hole.
 *
 * All fiat figures are UAH kopecks.
 */
export interface SaleProgress {
  saleId: string;
  publicId: string;
  status: TmaSaleStatus;
  /** What the order has to sell — the order's `fiatAmount`. */
  targetAmount: number;
  /**
   * Money in the jar, from the bank scrape — and the figure the progress bar
   * is drawn from, because it is what the user sees in their own banking app.
   *
   * `null` when the terminal has not been scraped yet: unknown, never zero, so
   * a client must not render it as an empty jar.
   */
  jarBalance: number | null;
  /**
   * Matched to an executed order so far.
   *
   * Distinct from {@link jarBalance}: money can sit in the jar without any
   * order accounting for it. This is the audited figure the backend settles
   * the order on; the jar balance is what the user watches.
   */
  receivedAmount: number;
  /**
   * What this order has actually taken in — **the figure the bar is drawn
   * from**, and the only one a client should measure progress with.
   *
   * The greater of {@link receivedAmount} and the jar's growth, decided by the
   * backend so that a screen never has to recombine two numbers into a third.
   * Each of them alone is wrong at some point in an order's life: money can sit
   * in the jar with no order accounting for it, which is exactly the case a
   * user notices because they can see it in their banking app — and once the
   * order closes the jar carries on moving while the sale does not, which froze
   * a completed ₴3 941 sale showing ₴2 889.
   */
  deliveredAmount: number;
  /**
   * Money that has been asked for and has not arrived — the sum of orders
   * routed to this jar and still open.
   *
   * Rendered as a translucent stretch ahead of {@link deliveredAmount}, so the
   * bar distinguishes "paid" from "on its way" instead of looking stalled while
   * three payers are mid-transfer. `0` when nothing is outstanding.
   */
  pendingAmount: number;
  events: readonly SaleEvent[];
  /**
   * Why the order was blocked, or `null` when it was not.
   *
   * Present alongside `status === BLOCKED` so the status page can explain the
   * cause rather than just the outcome. The figures the explanation needs are
   * already here: `targetAmount` is the jar target the user should have set,
   * and the `BLOCKED` timeline entry carries the one they actually set.
   */
  blockReason: SaleBlockReason | null;
  /**
   * Whether the user may stop this order early, right now.
   *
   * Computed per snapshot rather than inferred from `status`, because it also
   * depends on the terminal: an order with a payment still in play cannot be
   * stopped, and that can change between two snapshots without the status
   * moving at all. A button the user can see but not use is worse than one
   * that is honestly disabled.
   */
  canCancel: boolean;
  /**
   * Whether this order is waiting for its owner to close the jar.
   *
   * The jar outlives the order. Once an order is finished the jar behind it
   * keeps accepting money, and a payer who started late lands hryvnia in it
   * minutes after the order expired — money nothing matches, which comes back
   * as an appeal. So the jar has to be closed, and until it is, the user's next
   * sale slot stays taken and the stake of an order they stopped
   * themselves stays frozen.
   *
   * Nobody but the jar's owner can close it, so this is a **request the screen
   * has to make of them**, not a state to display quietly. `false` while the
   * order is still running, and once the bank has reported the jar closed.
   */
  awaitingJarClosure: boolean;
  /**
   * What will happen to a tail too small for any payment to cover.
   *
   * Snapshotted onto the order at creation and reported here so the status page
   * can tell the user whether they are waiting on a manual top-up or on nothing
   * at all — the difference between an order that needs somebody to act and one
   * that will close itself.
   */
  remainderPolicy: SaleRemainderPolicy;
  /**
   * USDT cents the order gave back to the balance as its unfillable tail.
   *
   * Zero until it completes, and on every order that filled its jar or waited
   * for a top-up. On the snapshot rather than left to the detail document,
   * because the order completes while the page is open — the detail is loaded
   * once, and the refund would otherwise appear only on the next visit.
   */
  refundedRemainderUsdt: number;
  /**
   * Which variant this is, so the page knows what it is rendering.
   *
   * Not inferable from the other fields: a card sale before its first order and
   * a jar sale that has never been scraped both show `jarBalance: null`, and
   * they need opposite screens. Absent on a snapshot built from a sale written
   * before the variant existed, which means {@link SaleMethod.JAR}.
   */
  saleMethod?: SaleMethod;
  /**
   * The orders this card sale's seller has to answer, oldest first.
   *
   * Empty on a jar sale, whose orders are the scraper's business rather than
   * the user's. On the snapshot rather than the detail document for the same
   * reason {@link refundedRemainderUsdt} is: an order arrives while the page is
   * open, and a detail loaded once would never show it.
   */
  cardOrders?: readonly SaleCardOrder[];
  /**
   * Whether this sale is waiting on a bank statement before its tail is released.
   *
   * True when a seller declared that some payment arrived short and no accepted
   * statement reaches as far as the moment they said it. The remainder — the
   * USDT that would otherwise come back to their balance — is held until one
   * does, which is what makes telling the truth cheaper than not.
   *
   * Absent on a jar sale, which has no claims of this kind to check.
   */
  statementRequired?: boolean;
  /**
   * The smallest order this card sale will be sent, in UAH kopecks, and how
   * many it will be split into at most.
   *
   * Both derived from the target by `saleCardMinOrderKopecks` and
   * `saleCardMaxOrders`, and sent rather than recomputed so the screen cannot
   * name a figure different from the one on the credential. Absent on a jar
   * sale.
   */
  cardMinOrderKopecks?: number;
  cardMaxOrders?: number;
  /**
   * The last stretch, once no payment can reach it and the sale is waiting for
   * somebody to transfer it by hand.
   *
   * `null` on every sale that is not in that state — which is most of them, and
   * includes a sale whose tail comes back as USDT: that one closes itself, so
   * there is nothing for a screen to explain.
   */
  tail?: SaleTailProgress | null;
  /** Epoch milliseconds this snapshot was built. */
  updatedAt: number;
}

/**
 * A tail waiting on a person, as the seller's screen has to explain it.
 *
 * **The point of it being on the snapshot is that the seller is owed an
 * explanation.** From their side the sale simply stops: the bar is nearly full,
 * no new payer arrives, and nothing says why. What is actually happening is
 * that the gap left is smaller than the payment pipeline will route an order
 * for, so it can only arrive as one transfer somebody makes by hand — which is
 * a different kind of waiting from every other pause in this product, and the
 * only one with no clock a payer is running.
 *
 * It has three states and the seller sees all three: nobody has been asked yet
 * (a statement of their own is still outstanding), an operator has been asked,
 * and an operator has taken it on. Only the third is an order on its way, and
 * only the third holds the sale open — for good, until the transfer is
 * confirmed or an operator gives the tail back.
 */
export interface SaleTailProgress {
  /** UAH kopecks still to collect. Always above zero. */
  amount: number;
  /**
   * Whether an operator has been asked to transfer it.
   *
   * `false` while the sale is still waiting on a statement of the seller's own —
   * a declared shortfall no document has settled is about to change this very
   * figure, so nobody is asked to send a number that is about to move. The
   * screen says which of the two it is, because only one of them is the
   * seller's to act on.
   */
  announced: boolean;
  /**
   * Whether an operator has answered that alert and is making the transfer.
   *
   * **The moment this sale gains a last order, and the moment it stops being
   * the seller's to end.** Asking is not the same as somebody going to their
   * banking app: until an operator says they have taken it on, nothing is on
   * its way, the seller may stop the sale like any other, and stopping costs
   * nobody anything. Once one has, real hryvnia is about to be sent to a card,
   * and a sale that closed in between would take it into a finished order.
   *
   * **And there is no clock on the other side of it.** A seller who says the
   * transfer never came is making a claim about what an operator did, and no
   * timer can settle that — only a person who can look at both sides. So the
   * hold does not expire: the sale ends when the transfer is confirmed, or when
   * an operator gives the tail back through support.
   *
   * So this is what the screen draws the order from, what the confirmation
   * button hangs off, and what `canCancel` goes false on — three things that
   * have to agree, from one field.
   */
  claimed: boolean;
}

/**
 * `POST /sales/:id/cancel` — what stopping early gave back.
 *
 * All figures are USDT cents. `refunded` is the stake minus whatever the jar
 * has already taken in, so a partly filled order returns only the untouched
 * part: the hryvnia already received is the user's, and the USDT that paid for
 * it is not theirs to have twice.
 */
export interface CancelSaleRes {
  /**
   * `CANCELLED` when the order ended there and then, `CLOSING` when orders were
   * still outstanding and it has to wait for them.
   *
   * The two are told apart by this and nothing else: a `CLOSING` answer carries
   * `refunded: 0`, because nothing has been given back yet and quoting a figure
   * would promise an amount the final settlement may not match — a late payer
   * can still reduce it.
   */
  status: TmaSaleStatus;
  refunded: number;
  /** What the jar had already received, converted at the order's own rate. */
  consumed: number;
  /** The caller's spendable balance after the refund landed. */
  balance: number;
}

// --- Realtime events -------------------------------------------------------

export interface DepositStatusEvent {
  depositId: string;
  status: TmaDepositStatus;
}

export interface SaleStatusEvent {
  orderId: string;
  status: TmaSaleStatus;
}

/** Payload of {@link TmaWsEventNames.SALE_PROGRESS}. */
export type SaleProgressEvent = SaleProgress;

export interface BalanceUpdateEvent {
  balance: number;
}
