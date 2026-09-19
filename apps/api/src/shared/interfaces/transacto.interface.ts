import type { WebhookEvent } from 'src/modules/webhook'

/**
 * The Transacto Trader REST API, as its OpenAPI document declares it.
 *
 * `https://app.transacto.us/api/trader`, authenticated with an `X-API-TOKEN`
 * header. This file is the whole of that contract in one place — orders,
 * credentials, appeals, the profile, the error codes and the three outbound
 * webhooks — because it is a single third party's surface and splitting it
 * across files only made it harder to see what we had and had not covered.
 *
 * **Everything here describes somebody else's wire format.** That is why the
 * fields are snake_case, and why nothing is optional out of taste: a field is
 * optional exactly when the specification says it may be absent or null. These
 * types are not ours to tidy. Renaming a field or narrowing a nullable compiles
 * and is then wrong at runtime, against a payload we do not control and cannot
 * redeploy.
 *
 * It does not belong in `@transacto/contracts` despite the name. That package
 * is the contract between *our* backend and *our* frontends; this is a third
 * party's, and the backend is its only consumer.
 */

/** The API's booleans on the way in: 1 or 0, never `true`. */
export type TransactoFlag = 0 | 1

// --- Errors ----------------------------------------------------------------

/**
 * `error_code` in a failed response.
 *
 * Numbered by the API, not by us. The ones we act on carry the consequence in
 * their doc comment; the rest are named so a log line can say what happened
 * rather than quote a bare integer.
 */
export enum TransactoErrorCode {
  /** Missing or invalid `X-API-TOKEN`. */
  UNAUTHORIZED = 101,
  /** The trader has API access turned off — only an admin can enable it. */
  API_DISABLED = 102,
  TRADER_DISABLED = 103,
  TRADER_CLOSED = 104,
  /**
   * Validation, and it covers a great deal: bad parameters, a card number
   * failing Luhn, a status outside {2, 7, 9} on execute, `new_amount <= 0`, and
   * any attempt to set `commission_rate` through the API.
   */
  VALIDATION = 105,
  /** Already `EXECUTED`; confirming again changes nothing upstream. */
  ORDER_ALREADY_EXECUTED = 106,
  /** The merchant's `order_id` starts with `TEST_`. Test orders never confirm. */
  TEST_ORDER = 107,
  /**
   * The trader's limit will not cover this order.
   *
   * The money has still arrived; only the confirmation was refused. The order
   * stays open in the Transacto cabinet until a human confirms it there, or
   * until our retry catches the limit once it resets.
   */
  INSUFFICIENT_TRADER_LIMIT = 108,
  /** `enable_orders=1` with no successful test order on that credential in the last hour. */
  NO_RECENT_TEST_ORDER = 109,
  /** A credential cannot be archived while an order on it is still awaiting payment. */
  CREDENTIAL_HAS_OPEN_ORDERS = 110,
  NOT_FOUND = 404,
  SERVER_ERROR = 500
}

/** The body of every failed response, whatever the HTTP status carrying it. */
export interface TransactoApiError {
  success: false
  error_code: TransactoErrorCode
  /** Developer-facing English, as written in Transacto's own source. Never shown to a user. */
  error_message: string
}

/** Present on every successful response; a failure carries `false` instead. */
export interface TransactoSuccess {
  success: true
}

/** The paging fields on `orders_list` and `appeals_list`. */
export interface TransactoPaged {
  count: number
  limit: number
  offset: number
}

// --- Enumerations ----------------------------------------------------------

/**
 * An order's lifecycle, as Transacto numbers it.
 *
 * Only three of these can be confirmed through the API — see
 * {@link TRANSACTO_EXECUTABLE_STATUSES}.
 */
export enum TransactoOrderStatus {
  /** Новая */
  NEW = 1,
  /** Ожидает оплаты — the state an order spends its life in until a payer acts. */
  WAITING_PAYMENT = 2,
  /** Клиент оплатил */
  CLIENT_PAID = 3,
  /** Клиент отменил */
  CLIENT_CANCELLED = 4,
  /** Исполнено — terminal, and the reason a second execute answers 106. */
  EXECUTED = 5,
  /** Отказ */
  DECLINED = 6,
  /** Аппеляция — money in dispute; still executable. */
  APPEAL = 7,
  /** Expired/Hold */
  EXPIRED_HOLD = 8,
  /** Просрочено — executable, because a late payer's money is still money. */
  OVERDUE = 9,
  /** Ошибочный */
  ERRONEOUS = 10,
  /** Мошенничество */
  FRAUD = 11,
  /** Ошибка трейдера */
  TRADER_ERROR = 12
}

/**
 * The statuses `orders_execute` accepts. Anything else answers
 * {@link TransactoErrorCode.VALIDATION}.
 */
export const TRANSACTO_EXECUTABLE_STATUSES = [
  TransactoOrderStatus.WAITING_PAYMENT,
  TransactoOrderStatus.APPEAL,
  TransactoOrderStatus.OVERDUE
] as const

/** What kind of credential a payer is given. `cred_type` on an order. */
export enum TransactoCredType {
  /** Карта */
  CARD = 1,
  /** Номер телефона */
  PHONE = 2,
  /** Счёт */
  ACCOUNT = 3,
  ECOM_4 = 4,
  ECOM_5 = 5,
  QR = 6
}

/**
 * Transacto's own currency ids.
 *
 * Named for the API rather than called `Currency`, which in a codebase holding
 * hryvnia kopecks and USDT cents reads like it might mean either of ours.
 */
export enum TransactoCurrency {
  ARS = 2,
  TJS = 3,
  KZT = 4,
  /** The only one this product actually trades in. */
  UAH = 5,
  KGS = 6,
  VND = 7,
  TRY = 8,
  /** Documented as `9 —`, with no code given. */
  NONE = 9
}

/** A dispute's lifecycle. */
export enum TransactoAppealStatus {
  /** Новый — the only status `appeals_execute` will act on. */
  NEW = 1,
  REJECTED_2 = 2,
  REJECTED_3 = 3,
  REJECTED_4 = 4,
  /** Удовлетворена, order executed as it stood. */
  SATISFIED = 5,
  /** Удовлетворена with a new amount. */
  SATISFIED_NEW_AMOUNT = 6,
  /** На модерацию — a fake receipt or a wrong amount, escalated. */
  MODERATION = 7,
  /** Ожидание чека */
  AWAITING_RECEIPT = 8
}

// --- Orders ----------------------------------------------------------------

export interface TransactoOrder {
  /** The internal id, and the only one `orders_execute` accepts. */
  id: number
  /**
   * The merchant's own reference — a string, and **not** what `orders_execute`
   * takes. Passing it there 404s against an order that plainly exists.
   */
  order_id: string
  amount: number
  status_id: TransactoOrderStatus
  cred?: string | null
  cred_type?: TransactoCredType | null
  /** The credential the payer was given. */
  card_id?: number | null
  terminal_id?: number | null
  currency_id?: TransactoCurrency | null
  /** The name a payer sees as the recipient — what we send as `name` on create. */
  receiver_name?: string | null
  receiver_bank?: string | null
  /** The payer's name, when the merchant supplied one. */
  customer_name?: string | null
  /** Not ISO: `2026-04-21 19:18:42`. */
  datetime?: string | null
  deadline?: string | null
  executed_datetime?: string | null
  /**
   * A test order. No webhook is ever sent for one, and
   * {@link TransactoErrorCode.TEST_ORDER} refuses to confirm it.
   */
  is_test?: TransactoFlag
}

export interface TransactoOrdersListResponse extends TransactoSuccess, TransactoPaged {
  orders: TransactoOrder[]
}

/** Query parameters `orders_list` understands. */
export interface TransactoOrdersListQuery {
  status_id?: TransactoOrderStatus
  /** Exact credential match — digits, `+`, `-` and spaces. */
  cred?: string
  card_id?: number
  /** 1–100; the API defaults to 50, which is why we always pass one. */
  limit?: number
  offset?: number
}

/**
 * `POST /orders_execute`.
 *
 * **Both `id` and `order_id` mean the internal numeric id.** The API accepts
 * either name for the same value; neither is the merchant's `order_id` string.
 */
export interface TransactoOrdersExecuteRequest {
  id?: number
  /** An alias for {@link id}, not the merchant's external reference. */
  order_id?: number
  /**
   * Settle for a different amount than the order was raised for.
   *
   * May be higher or lower, must be above zero. Omitted — or equal to the
   * current amount — leaves it alone. `amount_initial` is never rewritten, so
   * the original figure stays auditable.
   */
  new_amount?: number
}

export interface TransactoOrdersExecuteResponse extends TransactoSuccess {
  message: string
  order: TransactoOrder
}

// --- Credentials -----------------------------------------------------------

/**
 * A credential and the terminal fronting it, as `credentials_list` returns it.
 *
 * Named `Terminal` throughout this codebase, which predates the API calling it
 * a credential; `card_id` is the credential and `terminal_id` the terminal, and
 * both travel on every order.
 */
export interface Terminal {
  card_id: number
  terminal_id: number
  terminal_name: string
  payment_method_id: number
  /** The receiver's name, as a payer sees it. */
  name: string
  /** Card number. */
  cred?: string | null
  /** Phone number. */
  cred2?: string | null
  /** IBAN or anything else the method needs — we keep the jar URL here. */
  cred3?: string | null
  /**
   * "Публичная ссылка Mono Банки / Privat Конверта / PUMB Moneybox" — their
   * own documented home for a jar link.
   *
   * **Declared, never sent, and the discrepancy is deliberate.** This product
   * puts the jar URL in {@link cred3} and always has; Transacto stores it there
   * and hands it back there, which the entire bank scraper depends on — every
   * strategy reads `terminal.cred3` to find the jar it is watching. So the
   * observed behaviour and the documentation disagree about which field a link
   * belongs in, and the observed behaviour is the one carrying production
   * traffic. Worth asking them before anything moves.
   */
  cred_additional?: string | null
  enabled?: boolean
  enable_orders?: boolean
  allow_work?: boolean
  min_amount?: number
  max_amount?: number
  limit_by_day?: number
  max_turnover?: number
  max_turnover_daily?: number
  max_customers?: number
  max_open_orders?: number
  max_tx_count_daily?: number
  max_tx_count_total?: number
  commission_rate?: number
  added_datetime?: string | null
  terminal_is_active?: boolean | null
  terminal_is_archived?: boolean | null
}

export interface TransactoCredentialsListResponse extends TransactoSuccess {
  credentials: Terminal[]
  count: number
}

/**
 * `POST /credentials_create` — a credential and the terminal that fronts it.
 *
 * `commission_rate` is deliberately absent: the API answers
 * {@link TransactoErrorCode.VALIDATION} for it and takes the figure from the
 * trader's own settings.
 */
export interface TransactoCredentialsCreateRequest {
  terminal_name: string
  /** Which bank or payment method. See `BANK_PAYMENT_METHOD_ID`. */
  payment_method_id: number
  /**
   * The receiver's name, as a payer sees it — it comes back on every order as
   * `receiver_name`.
   *
   * Not a slot for our own identifiers. It used to carry `TMA-<telegramId>`,
   * which told a payer nothing and told an operator less than the terminal name
   * already does.
   */
  name: string
  /** Card number; validated with Luhn upstream. */
  cred?: string
  /** Phone number. */
  cred2?: string
  /** IBAN or anything else the method needs — we put the jar URL here. */
  cred3?: string
  /**
   * Their documented field for a jar link, which their docs call **required**
   * alongside `cred` for the UAH public-balance methods.
   *
   * Never sent, because `cred3` is what has been carrying every jar sale this
   * product has ever made — see {@link Terminal.cred_additional} for why the
   * two disagree and why nothing has been changed on the strength of a document.
   */
  cred_additional?: string
  min_amount?: number
  max_amount?: number
  limit_by_day?: number
  max_tx_count_daily?: number
  max_tx_count_total?: number
  /**
   * Whether Transacto may route payers here.
   *
   * The spelling matters. It was once sent as `enabled_orders`, which the API
   * silently ignores — so every terminal the Mini App created came up unable to
   * take a single order. Setting it can also require a successful test order on
   * the credential within the last hour; see
   * {@link TransactoErrorCode.NO_RECENT_TEST_ORDER}.
   */
  enable_orders?: TransactoFlag
  /** Whether the credential exists at all. */
  enabled?: TransactoFlag
  mono?: TransactoFlag
  counterparties_only?: TransactoFlag
  max_open_orders?: number
  /** Lifetime cap on what may pass through this credential. */
  max_turnover?: number
  max_turnover_daily?: number
  max_customers?: number
}

export interface TransactoCredentialsCreateResponse extends TransactoSuccess {
  message: string
  credential: Terminal
}

/**
 * `POST /credentials_update`. Every field but `card_id` is optional, and only
 * the ones sent are touched.
 *
 * **This list is the whole of what can be changed, and `name` is not on it.**
 * Neither are `cred`, `cred2`, `cred3` or `terminal_name`: nothing that
 * *identifies* a credential is updatable, only its limits and its switches.
 * Confirmed against both of Transacto's own documents — the field is accepted
 * by `credentials_create` and by nothing else, and no endpoint in their API
 * renames anything.
 *
 * So the name a payer sees is fixed when the credential is created and cannot
 * be corrected afterwards. The only route to a different one is
 * `credentials_delete` plus a fresh `credentials_create`, which archives the
 * terminal irreversibly, issues a new `card_id` and `terminal_id`, and is
 * refused outright while any order is awaiting payment — see
 * {@link TransactoCredentialsDeleteRequest}. That is not a rename; it is a
 * different terminal, and every order and sale pointing at the old one would
 * be pointing at nothing.
 */
export interface TransactoCredentialsUpdateRequest {
  card_id: number
  min_amount?: number
  max_amount?: number
  limit_by_day?: number
  max_turnover?: number
  max_turnover_daily?: number
  max_customers?: number
  max_open_orders?: number
  max_tx_count_daily?: number
  max_tx_count_total?: number
  enable_orders?: TransactoFlag
  enabled?: TransactoFlag
  allow_work?: TransactoFlag
}

export interface TransactoCredentialsUpdateResponse extends TransactoSuccess {
  message: string
  credential: Terminal
}

/**
 * `POST /credentials_delete` — archives the terminal and switches the
 * credential off. Refused with
 * {@link TransactoErrorCode.CREDENTIAL_HAS_OPEN_ORDERS} while any order on it
 * is still awaiting payment.
 *
 * **Deliberately never called, and there is no client method for it.** Archiving
 * cannot be undone: a credential that has been archived has to be created
 * again, with a new `card_id` and a new `terminal_id`. Every teardown this
 * product performs uses `credentials_update` instead, which is reversible.
 *
 * Declared anyway because this file is the Transacto contract and describes the
 * whole of it — see the *Third-party APIs* section of `apps/api/CLAUDE.md`. An
 * endpoint left undeclared reads as one nobody has looked at, which is a
 * different thing from one that was looked at and ruled out.
 */
export interface TransactoCredentialsDeleteRequest {
  card_id: number
}

export interface TransactoCredentialsDeleteResponse extends TransactoSuccess {
  message: string
  card_id: number
  terminal_id: number
}

// --- Profile ---------------------------------------------------------------

export interface TransactoProfile {
  id: number
  login: string
  title: string
  /**
   * The trader's current limit in their group's fiat currency (`limit_fiat`).
   *
   * A *limit*, not a wallet: it bounds how much they may confirm, which is why
   * exhausting it produces {@link TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT}
   * rather than a failed transfer.
   */
  balance: number
  /** The USDT balance behind that limit (`limit_usdt`). */
  balance_usdt: number
  /**
   * Neither suspended nor closed.
   *
   * `GET /profile` answers even when this is `false`, deliberately — so a token
   * belonging to a paused trader can still be verified.
   */
  is_active: boolean
  api_enabled: boolean
  default_commission: number
  currency_id?: TransactoCurrency | null
  currency_code?: string | null
  group_id?: number | null
}

export interface TransactoProfileResponse extends TransactoSuccess {
  profile: TransactoProfile
}

// --- Appeals ---------------------------------------------------------------

/** The order a dispute is about, as it appears nested inside an appeal. */
export interface TransactoAppealOrderRef {
  id: number
  /** The merchant's external reference. */
  order_id: string
  amount?: number | null
  cred?: string | null
  cred_type?: TransactoCredType | null
  card_id?: number | null
  terminal_id?: number | null
  status_id?: TransactoOrderStatus | null
  currency_id?: TransactoCurrency | null
}

export interface TransactoAppealReceipt {
  /** The payer's receipt. */
  url?: string | null
  wl_upload_url?: string | null
  /** The trader's own screenshot of the confirmation. */
  trader_url?: string | null
}

export interface TransactoAppeal {
  appeal_id: number
  status: TransactoAppealStatus
  created_at?: string | null
  executed_at?: string | null
  comments?: string | null
  trader_comments?: string | null
  /** The order's internal id. */
  order_internal_id: number
  /** The order's merchant reference. */
  order_id: string
  cred?: string | null
  amount?: number | null
  receipt_url?: string | null
  receipt?: TransactoAppealReceipt
  hash?: string | null
  priority?: number | null
  order?: TransactoAppealOrderRef
  /** An alias for {@link appeal_id}. */
  id?: number
  datetime?: string | null
  executed_datetime?: string | null
  screenshot?: string | null
  trader_screenshot?: string | null
  merchant_order_id?: string | null
}

export interface TransactoAppealsListResponse extends TransactoSuccess, TransactoPaged {
  appeals: TransactoAppeal[]
}

export interface TransactoAppealGetResponse extends TransactoSuccess {
  appeal: TransactoAppeal
}

/**
 * `POST /appeals_execute` — closes an open dispute.
 *
 * Only {@link TransactoAppealStatus.SATISFIED},
 * {@link TransactoAppealStatus.SATISFIED_NEW_AMOUNT} and
 * {@link TransactoAppealStatus.MODERATION} may be sent. A `SATISFIED_NEW_AMOUNT`
 * whose amount equals the current one is applied as a plain `SATISFIED`.
 *
 * Not called yet; typed alongside the appeal webhooks we do receive.
 */
export interface TransactoAppealsExecuteRequest {
  appeal_id: number
  status:
    | TransactoAppealStatus.SATISFIED
    | TransactoAppealStatus.SATISFIED_NEW_AMOUNT
    | TransactoAppealStatus.MODERATION
  trader_comments?: string
  /** Required for {@link TransactoAppealStatus.SATISFIED_NEW_AMOUNT}. */
  new_amount?: number
}

export interface TransactoAppealsExecuteResponse extends TransactoSuccess {
  message: string
  appeal: TransactoAppeal
}

// --- Webhooks --------------------------------------------------------------

/**
 * The order as an outbound webhook carries it.
 *
 * A narrower shape than {@link TransactoOrder}: the delivery omits
 * `receiver_name`, `receiver_bank`, `customer_name` and `is_test`. The last is
 * omitted because it can only ever have been 0 — a test order produces no
 * webhook at all.
 */
export interface TransactoWebhookOrder {
  id: number
  order_id: string
  amount: number
  status_id: TransactoOrderStatus
  cred?: string | null
  card_id?: number | null
  terminal_id?: number | null
  currency_id?: TransactoCurrency | null
  datetime?: string | null
  deadline?: string | null
  executed_datetime?: string | null
}

/**
 * `order.created`, `order.paid`, `order.cancelled`.
 *
 * `event` is documented as required on the body, but Transacto also names the
 * event in the `X-Event` header and in practice a delivery may carry only the
 * header — which is why our DTO treats the body field as optional.
 */
export interface OrderWebhookPayload {
  event: WebhookEvent
  order: TransactoWebhookOrder
  trader_id: number
  /** ISO 8601. */
  timestamp: string
}

/**
 * `appeal.created`, `appeal.updated`.
 *
 * Acknowledged and dropped today. Typed because it is a delivery we genuinely
 * receive and sign-check, and an untyped one is a payload nobody can reason
 * about when the time comes to act on it.
 */
export interface AppealWebhookPayload {
  event: WebhookEvent
  appeal: TransactoAppeal
  trader_id: number
  /** ISO 8601. */
  timestamp: string
}

/**
 * `balance.low` — the trader's USDT limit fell to the threshold or below.
 *
 * Carries no order, which is why the webhook DTO cannot require one: requiring
 * it answered 400, and a 400 is retried, so a delivery we would have dropped
 * anyway came back forever.
 */
export interface BalanceWebhookPayload {
  event: WebhookEvent
  trader_id: number
  balance_usdt: number
  balance_fiat?: number
  currency_code?: string | null
  /** 500 at the time of writing. */
  threshold_usdt: number
  /** ISO 8601. */
  timestamp: string
}

/** Any delivery Transacto can send to the webhook URL. */
export type TransactoWebhookPayload =
  | OrderWebhookPayload
  | AppealWebhookPayload
  | BalanceWebhookPayload
