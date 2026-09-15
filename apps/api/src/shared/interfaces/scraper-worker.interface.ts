/**
 * The wire contract with the Isolated Scraper Worker — the throwaway box, on its
 * own VPS and reachable only over Tor, that makes this process's outbound bank
 * requests so that the machine holding the data never opens the socket.
 *
 * This is a third-party contract in the layering sense (an `.api.service.ts`
 * speaks it), but it is *our* service, so the shapes are authoritative rather
 * than captured. They mirror the worker's own `POST /scrape` contract; the
 * worker's README is the source of truth if the two ever disagree.
 */

/**
 * The egress network the worker should leave through, named by the nature of the
 * exit, never by the destination. Which bank needs which channel is knowledge
 * that stays here, on the origin — the worker only maps a channel to a proxy
 * list it holds.
 *
 * - `POOL`: a rotating residential/commercial pool. For hosts that refuse Tor
 *   exits but answer from residential addresses (monobank's CA, the bank scrapes).
 * - `TOR`: the Tor network. For hosts that block the pool's ranges but are
 *   reachable over Tor (PrivatBank).
 */
export enum EgressChannel {
  POOL = 'POOL',
  TOR = 'TOR'
}

/** The worker's failure codes, as returned in a non-200 `{ code }` body. */
export enum ScraperWorkerErrorCode {
  INVALID_JSON = 'INVALID_JSON',
  INVALID_URL = 'INVALID_URL',
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNKNOWN_CHANNEL = 'UNKNOWN_CHANNEL',
  UNAUTHORIZED = 'UNAUTHORIZED',
  URL_NOT_ALLOWED = 'URL_NOT_ALLOWED',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  REQUEST_TOO_LARGE = 'REQUEST_TOO_LARGE',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  CHANNEL_UNAVAILABLE = 'CHANNEL_UNAVAILABLE',
  BUSY = 'BUSY',
  PROXY_REFUSED = 'PROXY_REFUSED',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
  UPSTREAM_FAILED = 'UPSTREAM_FAILED',
  INTERNAL = 'INTERNAL'
}

/** HTTP methods the worker relays. */
export enum ScraperWorkerMethod {
  GET = 'GET',
  POST = 'POST'
}

/**
 * One request to the worker.
 *
 * `session` + `rotate` are how the rotation policy — which stays here — drives
 * the worker's exit affinity: a stable `session` pins one exit across a
 * lookup-then-download pair, and `rotate` steps it to a fresh one when this side
 * has judged the current exit spent.
 */
export interface ScraperWorkerRequest {
  readonly url: string
  readonly channel: EgressChannel
  readonly method?: ScraperWorkerMethod
  /** POST only; a string (urlencoded, JSON, or base64 for an upload). */
  readonly body?: string
  /** Required when `body` is set. */
  readonly contentType?: string
  /** Captured browser headers to replay; origin-revealing and framing headers are refused by the worker. */
  readonly headers?: Readonly<Record<string, string>>
  /** Forwarded verbatim as the `Cookie` header. */
  readonly cookie?: string
  readonly session?: string
  readonly rotate?: boolean
  /** Cap on the response body; the worker clamps to its own 16 MB ceiling. */
  readonly maxBytes?: number
}

/**
 * The worker's `200`: *our* fetch succeeded. What the target itself said is a
 * separate fact — `upstreamStatus` — and even a `4x`/`5xx` there is a successful
 * relay, not a worker failure.
 */
export interface ScraperWorkerResult {
  readonly upstreamStatus: number
  readonly contentType?: string
  /** Present on a 3xx; the worker does not follow redirects. */
  readonly location?: string
  /** The target's `Set-Cookie`(s), decoded — one entry per cookie — when present. */
  readonly setCookie?: readonly string[]
  readonly body: Buffer
}

/**
 * A worker call's outcome. Distinct from a *target* status: `ok: false` is the
 * worker itself refusing or failing to deliver (a dead exit, a channel it does
 * not have), which is what the rotation policy reads.
 */
export type ScraperWorkerOutcome =
  | { readonly ok: true; readonly result: ScraperWorkerResult }
  | { readonly ok: false; readonly code: ScraperWorkerErrorCode; readonly status: number }
