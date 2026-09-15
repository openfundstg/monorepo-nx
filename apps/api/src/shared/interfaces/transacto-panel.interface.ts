/**
 * The Transacto **admin panel**, as captured from live calls.
 *
 * `https://app.transacto.us`, and a different API from the one in
 * `transacto.interface.ts` in every respect that matters. That one is the
 * documented Trader REST API under `/api/trader`, authenticated per request
 * with an `X-API-TOKEN`. This one was built for the panel's own browser UI, has
 * no published specification, and authenticates with a **session cookie** —
 * the token is not accepted here at all.
 *
 * Because there is no specification, every shape below was captured by calling
 * the real endpoints and printing keys and types. Where something was not
 * observed it says so rather than guessing.
 *
 * **Nothing here is ours to tidy.** `2fa_code` keeps its leading digit and
 * snake_case because that is the form field's name on the wire.
 */

// --- Authentication --------------------------------------------------------

/**
 * The form `POST /login` accepts, sent as `application/x-www-form-urlencoded`
 * — not JSON, despite the JSON response.
 *
 * Observed: no CSRF field, and no session cookie required beforehand. A single
 * cold POST authenticates.
 */
export interface TransactoPanelLoginRequest {
  readonly email: string
  readonly password: string
  /**
   * The panel's two-factor code. Sent empty for an account with 2FA off, which
   * is what the service account uses. **The response to a login that requires a
   * code has not been observed**, so nothing here describes it.
   */
  readonly '2fa_code': string
  /**
   * Literally `'on'`, the value an HTML checkbox submits. Without it the
   * response carries no `remember_token`, and only the short-lived PHP session
   * comes back — which is the difference between logging in monthly and
   * logging in on every restart.
   */
  readonly remember_me: 'on'
}

/**
 * `POST /login`, 200, on success: `{"status":"ok"}`.
 *
 * **Not load-bearing, deliberately.** A failed login was never attempted
 * against the production account — one wrong password risks locking the trader
 * the Mini App depends on — so the failure shape is unknown, and a service that
 * branched on `status` would be branching on a value it cannot recognise the
 * other half of. Authentication is instead judged by whether the response set a
 * `remember_token`, which is the thing actually needed. Declared because it
 * arrives, not because anything reads it.
 */
export interface TransactoPanelLoginResponse {
  /** `'ok'` on the observed success. Other values unknown. */
  readonly status: string
}

/**
 * The cookies the panel issues. Values are session credentials and must never
 * reach a log line.
 */
export enum TransactoPanelCookie {
  /**
   * The long-lived one: `Max-Age=2592000`, thirty days. Observed to be
   * **sufficient on its own** — presented without a PHP session it is accepted
   * and a fresh `PHPSESSID` is minted in the reply. That is why the service
   * keeps this and not the session cookie. It is not rotated on use, and
   * several issued to one account stay valid at the same time, so two API
   * replicas do not evict each other.
   *
   * **Thirty days is the cookie's claim, not a guarantee.** One token was seen
   * refusing within minutes of being issued, for a reason never established;
   * repeated probing to find it would have meant hammering a production
   * account's login. This is why the service treats a `302` as routine and
   * repairs it with a fresh login rather than trusting the expiry.
   */
  REMEMBER_TOKEN = 'remember_token',
  /** The PHP session. Short-lived, and re-issued from the token as needed. */
  SESSION = 'PHPSESSID',
  /** The panel UI's language. Irrelevant to us; named so it is not a mystery. */
  UI_LANGUAGE = 'trader_ui_lang'
}

// --- Rates -----------------------------------------------------------------

/**
 * `GET /panels/current_rate`, the USDT price the panel itself quotes.
 *
 * ```json
 *  {"rate":44.91}
 * ```
 *
 * `rate` is **UAH for one USDT**, as a decimal number — not kopecks, and not
 * the inverse. Confirmed by magnitude against Binance's `USDTUAH` ticker in the
 * same minute: 46.41 there against 44.91 here, the ~3% below market being
 * Transacto's own spread.
 *
 * Only `rate` has ever been observed in the body. The response is served with
 * `Cache-Control: no-store` and a leading space before the `{` — a PHP output
 * artifact that `JSON.parse` skips, but which rules out comparing the body as a
 * string.
 *
 * **Unauthenticated, this endpoint answers `302` to `/login`, not `401`.** A
 * client that follows redirects therefore receives `200 text/html` — eleven
 * kilobytes of login page — and reads `rate` as `undefined` off it. Verified
 * against the live endpoint.
 */
export interface TransactoPanelRateResponse {
  /** UAH per 1 USDT, e.g. `44.91`. */
  readonly rate: number
}

// --- Sessions --------------------------------------------------------------

/**
 * `POST /panels/session_keepalive`, body `{"action":"keepalive"}` as **JSON**
 * — the one panel endpoint that is not a form post.
 *
 * ```json
 * {"status":"success","message":"Сесію оновлено",
 *  "data":{"user_id":"592",
 *          "session_info":{"session_active":true,"last_activity":1788431260,
 *                          "session_start":1788429352},
 *          "timestamp":1788431260}}
 * ```
 *
 * Two uses, and the second is why it is worth having. It refreshes the PHP
 * session's idle clock, and it answers *whether the session is alive* without
 * touching anything that moves money — so a worker can check its credentials
 * before reserving somebody's payout rather than discovering the problem
 * halfway through.
 *
 * Note `status` is `'success'` here and `'ok'` on every payout action. The
 * panel does not use one envelope, so nothing may branch on a shared constant.
 *
 * `user_id` arrives as a **string** despite being a number, and the timestamps
 * are epoch **seconds**, not milliseconds. The response to an expired session
 * has not been observed — the endpoint is reached only through a session that
 * has just been used.
 */
export interface TransactoPanelKeepaliveResponse {
  /** `'success'` on the observed reply. Other values unknown. */
  readonly status: string
  /** The panel's own words, localised by `trader_ui_lang`. Developer-facing only. */
  readonly message: string
  readonly data: {
    /** Numeric id as a string, e.g. `"592"`. */
    readonly user_id: string
    readonly session_info: {
      readonly session_active: boolean
      /** Epoch **seconds**. */
      readonly last_activity: number
      /** Epoch **seconds**. */
      readonly session_start: number
    }
    /** Epoch **seconds**. */
    readonly timestamp: number
  }
}

// --- Payouts ---------------------------------------------------------------

/**
 * How a payout is settled, as `data-value` on the type column.
 *
 * Only {@link CARD} has been observed for UAH. The other two are offered by the
 * panel's own filter, and belong to the Russian market — `SBP` is the fast
 * payment system, `ACCOUNT` a bank account.
 */
export enum TransactoPayoutType {
  CARD = 'CARD',
  SBP = 'SBP',
  ACCOUNT = 'ACCOUNT'
}

/**
 * A payout's lifecycle, as `data-value` on the status column.
 *
 * The Ukrainian label beside it in the same cell is rendered text and drifts
 * between languages — sometimes Russian even under `trader_ui_lang=uk`. Only
 * the `data-value` is read.
 */
export enum TransactoPayoutStatus {
  /** Unassigned, in the open book. Anybody's to take. */
  NEW = 'NEW',
  /** Assigned to a trader and awaiting receipts. */
  PENDING = 'PENDING',
  /** Receipts attached, but they do not yet cover the amount. */
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  /** Fully covered and closed. */
  COMPLETED = 'COMPLETED',
  /** Ended without being paid. */
  FAILED = 'FAILED'
}

/**
 * The panel's currency ids, from the options of its own filter `<select>`.
 *
 * Numbers, not ISO codes, and not contiguous — 3, 6 and 7 are absent from the
 * list the panel renders.
 */
export enum TransactoPanelCurrencyId {
  RUB = 1,
  ARS = 2,
  KZT = 4,
  UAH = 5,
  TRY = 8
}

/**
 * One row of a payouts table, as read from the `data-value` attributes.
 *
 * There is no JSON for this: `GET /panels/payouts?ajax_new_payouts`,
 * `?ajax_active_payouts` and `?ajax_history` each return an HTML fragment, and
 * the full page returns all three inside tabs. Every cell carries both a
 * rendered label and a `data-value`; only the latter is stable.
 *
 * **Times are UTC+3, unlike the JSON on the same host.** A row created at
 * `2026-09-03 12:30:33` was created at 09:30:33 UTC — the shift is visible by
 * comparing a check row against the `Date` header of the very response carrying
 * it. `TransactoPanelCheckData.created_at`, by contrast, is UTC. Nothing here
 * may be parsed as local time or compared against a JSON timestamp unshifted.
 *
 * **`cred` is a full payment credential and is never masked on the wire.** The
 * panel's own UI stars it out in JavaScript for unassigned rows, so a card
 * number is readable server-side long before the payout is anybody's. It must
 * not reach a log line.
 */
export interface TransactoPanelPayoutRow {
  readonly id: number
  /** `YYYY-MM-DD HH:mm:ss`, **UTC+3**. */
  readonly created_at: string
  readonly type: TransactoPayoutType
  /** Card number, phone or account — whichever {@link type} implies. Never logged. */
  readonly cred: string
  /** Empty on every UAH row observed; the panel renders `-` for it. */
  readonly recipient_name: string
  /** Decimal string with two places, e.g. `'1706.00'` — hryvnia, not kopecks. */
  readonly amount: string
  readonly status: TransactoPayoutStatus
  readonly currency_id: TransactoPanelCurrencyId
  /** Empty on every UAH row observed. */
  readonly receiver_bank: string
}

/**
 * One row of `GET /panels/payouts?ajax_checks` — a receipt already attached to
 * a payout.
 *
 * This is how coverage is counted: each row names the payout it belongs to and
 * the amount Transacto recognised, so the sum over one `payout_id` is what the
 * counterparty considers received. Times are UTC+3, as everywhere in these
 * tables.
 *
 * `check_url` is a **public** object-storage link, served without
 * authentication. It is kept for an operator to open and is never handed to a
 * Mini App user.
 */
export interface TransactoPanelCheckRow {
  /** The row's own id, from `data-id` on the `<tr>`. */
  readonly id: number
  /** When the receipt was attached. `YYYY-MM-DD HH:mm:ss`, **UTC+3**. */
  readonly created_at: string
  /** When the transfer happened, off the receipt itself. **UTC+3**. */
  readonly date: string
  readonly payout_id: number
  readonly check_url: string
  /** Decimal string with two places, e.g. `'600.00'` — hryvnia. */
  readonly amount: string
  readonly receiving_bank: string
  /** Empty on the observed rows. */
  readonly sender: string
  /** Empty on the observed rows. */
  readonly recipient: string
}

/**
 * `GET /panels/payouts?payouts_count` — how many payouts are in the open book.
 *
 * ```json
 * {"status":"ok","count":3}
 * ```
 *
 * The cheapest way to notice the book changed: a poller compares the count and
 * only pays for the HTML fragment when it moves.
 */
export interface TransactoPanelPayoutsCountResponse {
  readonly status: string
  readonly count: number
}

/**
 * `POST /panels/payout_actions?<action>=1&id=<payoutId>`, form-encoded with
 * `csrf_token`.
 *
 * The actions this codebase uses:
 *
 * - `assign_trader=1` — take an unassigned payout. `{"status":"ok","message":"Виплату успішно призначено"}`
 * - `release_payout=1` — hand it back to the book.
 * - `cannot_send_payout=1` — hand it back and mark it undeliverable. Not used here.
 *
 * **The refusal shape is unknown.** No failing response has been captured —
 * including the one that matters most, assigning a payout another trader has
 * already taken. The panel's own JavaScript treats anything whose `status` is
 * not `'ok'` as a failure and shows `message`, which is the only behaviour that
 * can be relied on until a real refusal is seen. `message` is localised by the
 * `trader_ui_lang` cookie and mixes Russian and Ukrainian; it is for logs, not
 * for a user.
 */
export interface TransactoPanelPayoutActionResponse {
  /** `'ok'` on success. Values on failure unobserved. */
  readonly status: string
  readonly message?: string
}

// --- Receipts --------------------------------------------------------------

/**
 * Where a receipt recognition job stands, as the `status` of every response in
 * the upload → poll → confirm sequence.
 *
 * Deliberately its own enum rather than strings shared with the payout actions:
 * the same field name carries a different vocabulary on these endpoints, and
 * `'ok'` means "receipt attached" here while it means "payout assigned" there.
 */
export enum TransactoPanelCheckParseStatus {
  /** Recognition is running. Observed to finish in about two seconds. */
  PARSING = 'parsing',
  /** Recognition finished; the fields are for confirmation, nothing is saved yet. */
  PREVIEW = 'preview',
  /** The receipt is attached to the payout. Only ever seen from `confirm_check`. */
  OK = 'ok',
  /** No job is running for this payout — the reply to `parse_check_active=1`. */
  IDLE = 'idle'
}

/**
 * What Transacto read off a receipt.
 *
 * Captured whole from a live PUMB card transfer; **every key below was present
 * in that response**, including the ones it filled with `null`, which is why
 * they are declared rather than left out. What varies between banks is which of
 * them hold a value, not which exist — so nothing here is optional and the
 * empty ones are typed `| null`.
 *
 * The exceptions are marked: a handful of fields are read by the panel's own
 * JavaScript but have never appeared in a captured response. They are declared
 * optional and say so, because the alternative — leaving them out — hides that
 * some bank's receipt is expected to carry them.
 *
 * `total_amount` is **hryvnia as a number** (600, not 60000), where the payout
 * tables give a decimal string. Two representations of money on one host.
 */
export interface TransactoPanelCheckFields {
  /** `YYYY-MM-DD HH:mm:ss`, the bank's own stamp on the receipt. */
  readonly transaction_date: string
  /** Hryvnia, as a number. This is the figure coverage is counted in. */
  readonly total_amount: number
  /** Whatever the transfer was addressed to — a card number here. Never logged. */
  readonly recipient_cred: string
  readonly receiving_bank: string
  /** Empty string on the observed receipt; `sender_name` carried the person. */
  readonly sender: string
  /** Empty string on the observed receipt. */
  readonly recipient: string
  readonly bank: string
  /** `'Card'` — note the capitalisation, unlike {@link TransactoPayoutType}. */
  readonly type: string
  /** The bank's own label, e.g. `'Перевод Card ПУМБ'`. Rendered text. */
  readonly receipt_type: string
  /** The bank's operation label, e.g. `'Переказ на картку'`. Rendered text. */
  readonly operation_type: string
  /** `YYYY-MM-DD HH:mm:ss` — equal to {@link transaction_date} on the sample. */
  readonly receipt_created: string
  /** Hryvnia. `0` on the observed receipt. */
  readonly commission: number
  /** Hryvnia, where the receipt states it separately from the amount. */
  readonly total_debited: number | null
  /** Russian fast-payment id. `null` on a card transfer. */
  readonly sbp_id: string | null
  readonly auth_code: string | null
  readonly recipient_name: string | null
  readonly recipient_phone: string | null
  readonly recipient_bank: string | null
  /** Never logged. */
  readonly recipient_card: string | null
  /** Never logged. */
  readonly recipient_iban: string | null
  /** The payer's own name, off their receipt. Personal data. */
  readonly sender_name: string | null
  /** The payer's IBAN. A payment credential — never logged. */
  readonly sender_account: string | null
  /** Payment purpose. */
  readonly message: string | null
  readonly receipt_number: string | null
  /**
   * **Not observed.** Read by the panel's UI as a fallback for {@link type},
   * so some bank's receipt is expected to carry it instead.
   */
  readonly transfer_type?: string
}

export interface TransactoPanelCheckData {
  readonly parsed_fields: TransactoPanelCheckFields
  readonly bank: string
  /**
   * When recognition finished, `YYYY-MM-DD HH:mm:ss` — and **UTC**, unlike
   * every timestamp in the panel's HTML tables, which are UTC+3. Verified
   * against the `Date` header of the response carrying it. Absent from the
   * `confirm_check` reply, present on the `preview`.
   */
  readonly created_at?: string
}

/**
 * Every reply in the receipt sequence, discriminated by {@link status}.
 *
 * The sequence itself, all form-encoded with `csrf_token` unless noted:
 *
 * 1. `POST /panels/payout_actions?upload_check=1&id=<payoutId>` — **multipart**,
 *    fields `file`, `csrf_token`, `preview_only=1`. Answers `parsing` with a
 *    `job_id`.
 * 2. `POST …?parse_check_status=1&id=<payoutId>` with `job_id` — poll until the
 *    status is no longer `parsing`. Answers `preview` with the fields.
 * 3. `POST …?confirm_check=1&id=<payoutId>` with `force_accept` — this is the
 *    write. Answers `ok`.
 *
 * `POST …?parse_check_active=1&id=<payoutId>` answers `idle` or `parsing`, and
 * is how a restart finds a job it was already waiting on.
 *
 * **Confirmation is addressed by payout, not by job.** Step 3 carries no
 * `job_id`, so the panel holds exactly one parsed receipt per payout and
 * confirms whatever is parked there — which is why two uploads may never be in
 * flight against one payout at the same time.
 *
 * **`force_accept` is always sent `false` here.** The panel offers it to push a
 * receipt through against its own recognition warning; using it would mean
 * overriding the counterparty's anti-fraud check with our guess about somebody
 * else's money.
 *
 * The failure shape is only partly known: the panel's UI reads `error_message`,
 * `warningMessage` and `allowForceAccept`, and no failing response has been
 * captured to confirm which arrive together. They are declared optional for
 * that reason, and their text is developer-facing — mixed Russian and
 * Ukrainian, localised by cookie.
 */
export interface TransactoPanelCheckResponse {
  readonly status: TransactoPanelCheckParseStatus | string
  /** Echoed back on every reply in the sequence. */
  readonly payoutId?: number
  /** Present with `parsing`; the handle the poll is addressed with. */
  readonly job_id?: number
  /** Present with `preview` and `ok`. */
  readonly checkData?: TransactoPanelCheckData
  /** The panel's own words on a refusal. Logs only. */
  readonly error_message?: string
  /** The panel's own words on success. Logs only. */
  readonly message?: string
  /** Set where recognition disagreed with the payout but the receipt is still offered. */
  readonly warningMessage?: string
  /** Whether the panel would accept this receipt with `force_accept`. Never used. */
  readonly allowForceAccept?: boolean
}
