import { HttpStatus } from '@nestjs/common'
import { isAxiosError, type AxiosError } from 'axios'

/**
 * When a failed request is worth one more attempt from a different address.
 *
 * **Two different failures, one remedy, and three consumers had worked that out
 * separately before this file existed.** `403` and `429` are somebody's WAF
 * refusing the address; `502`, `503` and `504` are, on a pool of residential
 * exits, most often the exit itself dying mid-request. The same status arrives
 * whether the destination is unwell or the route to it is, and only the retry
 * tells them apart.
 *
 * The bank scraper reached this conclusion first, the Transacto panel reached
 * it again, and PrivatBank's document service reached it a third time — in
 * production, as a `503` on a host that answers `200` to the same request made
 * directly. Three copies of a rule about somebody else's infrastructure is
 * three chances to update two of them.
 */
export const PROXY_REPAIRABLE_STATUSES: readonly number[] = [
  HttpStatus.FORBIDDEN,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.BAD_GATEWAY,
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT
]

/**
 * How many addresses one request is allowed to try before giving up.
 *
 * **Three, because the pool has dead exits and it is the pool that answers.**
 * Measured on the live pool: `CONNECT` to port 10000 answered `503` for
 * `privatbank.ua`, `check.gov.ua` and `app.transacto.us` alike — the same
 * refusal for every destination, which is a dead exit and not a host refusing
 * anybody. A failure like that says nothing about where the request was going,
 * so stopping after one retry reports an outage that a third address would have
 * walked straight past.
 *
 * Still small. A hundred and fifty addresses is not a licence to walk them: a
 * destination that is genuinely down answers the same way from all of them, and
 * the difference between three attempts and thirty is thirty spent addresses
 * and a user waiting.
 *
 * The bank scraper reached three independently, long before any of this.
 */
export const PROXY_ATTEMPTS = 3

/**
 * The transport failures that mean "this exit is gone", not "this host is".
 *
 * A borrowed address disappears mid-connection far more often than a bank does,
 * and every one of these is what that looks like from here.
 */
const REPAIRABLE_CODES: readonly string[] = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPROTO'
]

/**
 * Whether this failure is worth retrying through another proxy.
 *
 * Deliberately narrow. A `404` is an answer, a `400` is our own request being
 * wrong, and retrying either from a new address only spends an IP to be told
 * the same thing — which on a rate-limited pool is how a real outage is
 * manufactured out of a bad request.
 */
export const isRepairableThroughAnotherProxy = (error: unknown): boolean => {
  if (!isAxiosError(error)) return false

  const status = error.response?.status

  if (status !== undefined) return PROXY_REPAIRABLE_STATUSES.includes(status)

  return error.code !== undefined && REPAIRABLE_CODES.includes(error.code)
}

/**
 * What a refused response looked like, in terms safe to log.
 *
 * A `503` through a proxy has two very different causes and they need different
 * remedies: the destination's WAF turning the address away, or the exit itself
 * dying. From here they arrive identically, and the body is the only thing that
 * distinguishes them — a WAF serves a page and says whose it is, while a dead
 * exit serves nothing.
 *
 * Only the shape is reported. The body of a refusal is somebody else's HTML and
 * may be a hundred kilobytes of it; what an operator needs is its size and
 * whether it names a filter.
 */
export const describeRefusal = (error: unknown): string => {
  if (!isAxiosError(error)) return 'not an HTTP failure'

  const status = error.response?.status ?? 'no status'
  const body = error.response?.data

  if (body === undefined) return `${status}, no body`

  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const filter = WAF_MARKERS.find((marker) => text.toLowerCase().includes(marker))

  const who = whoAnswered(error.response?.headers)
  const shape = `${status}, ${text.length} bytes${filter === undefined ? '' : `, mentions ${filter}`}`

  return looksLikeARefusedTunnel(error)
    ? `${shape}, and this is the shape of a proxy refusing the tunnel rather than a reply from ${
        error.config?.url ?? 'the destination'
      }`
    : `${shape}, from ${who}`
}

/**
 * Whether this "response" is really the proxy declining to connect us.
 *
 * **The distinction that cost a day.** A proxy that refuses a `CONNECT` answers
 * on the same socket the request was about to use, so Node parses its reply as
 * though the destination had sent it: axios reports `503`, `ERR_BAD_RESPONSE`
 * and a body of nothing. Read literally, that says PrivatBank refused us —
 * which sent a whole investigation at PrivatBank, at their WAF, and at the
 * addresses they might be blocking, while the destination was answering `200`
 * to anyone who asked it directly.
 *
 * Reproduced deliberately against a proxy that refuses every tunnel: the shape
 * is an error status, an empty body, and no header that names a server. A real
 * `503` from a real host arrives with its `date`, its length and usually its
 * `server` — so the absence of all three is the tell.
 *
 * It is a strong hint and not a proof, which is why the sentence says "the
 * shape of". A destination could answer an empty `503` too; it just does not,
 * in any capture this codebase has.
 */
const looksLikeARefusedTunnel = (error: AxiosError): boolean => {
  const status = error.response?.status
  if (status === undefined || !PROXY_REPAIRABLE_STATUSES.includes(status)) return false

  const body = error.response?.data
  const hasBody = typeof body === 'string' ? body.length > 0 : body !== undefined && body !== null
  if (hasBody) return false

  const headers = error.response?.headers
  if (headers === null || typeof headers !== 'object') return true

  return !ORIGIN_HEADERS.some((name) => (headers as Record<string, unknown>)[name] !== undefined)
}

/**
 * Which machine produced a refusal, as far as its headers admit.
 *
 * The question a bare `503` cannot answer on its own, and the one that decides
 * where to look: the destination's own front door, something in front of it, or
 * the proxy in between. PrivatBank answers `server: nginx` when it is really
 * them; an empty body from anything else is a different problem entirely.
 *
 * Only these headers and only their values — none of them says anything about
 * the request that produced them.
 */
const whoAnswered = (headers: unknown): string => {
  if (headers === null || typeof headers !== 'object') return 'no headers at all'

  const all = headers as Record<string, unknown>

  const named = ORIGIN_HEADERS.map((name) => {
    const value = all[name]

    return value === undefined ? null : `${name}=${String(value).slice(0, 40)}`
  }).filter((entry): entry is string => entry !== null)

  if (named.length > 0) return named.join(' ')

  // None of the headers that identify a server. Which ones *are* there is then
  // the only remaining evidence, and their names alone are enough: a real HTTP
  // server sends `date` and a length, while a refusal synthesised closer to
  // home tends to send almost nothing. Names only — a value here could be a
  // session cookie.
  const present = Object.keys(all).sort()

  return present.length === 0
    ? 'nothing that names a server, and no headers at all'
    : `nothing that names a server; headers present: ${present.join(', ')}`
}

/** Headers that say who answered, rather than what they answered. */
const ORIGIN_HEADERS: readonly string[] = ['server', 'via', 'x-amz-cf-pop', 'x-cache', 'cf-ray']

/**
 * Names a filter puts in its own refusal page.
 *
 * Present means the destination refused the address; absent means it is more
 * likely nothing answered at all, which on a borrowed exit is the ordinary
 * case. Neither is proof, and the log says "mentions", not "was blocked by".
 */
const WAF_MARKERS: readonly string[] = [
  'awswaf',
  'cloudflare',
  'captcha',
  'access denied',
  'forbidden'
]

/**
 * One call, walked across a few addresses when the failure is about the address.
 *
 * The third consumer is what made this shared. The Transacto panel, PrivatBank's
 * document service and monobank's certification service each worked the same
 * rule out separately, and a rule about *when to rotate* that lives in three
 * places is three rules that will drift — which is exactly what happened to the
 * predicate above before it was given one home.
 *
 * What is deliberately **not** shared is the log line. Each caller says who it
 * was talking to and how far along it got, and flattening those into one
 * sentence would produce the thing this module's history warns about: a message
 * that blames the destination for a refusal the proxy issued.
 *
 * @param attempt Runs once per address. Must be re-callable.
 * @param rotate Called between attempts with the failure and the number of the
 *   attempt about to be made. Rotates the pool, and says so in the caller's own
 *   words.
 */
export const walkingThePool = async <T>(
  attempt: () => Promise<T>,
  rotate: (error: unknown, nextAttempt: number) => void
): Promise<T> => {
  const attempts = Array.from({ length: PROXY_ATTEMPTS }, (_unused, index) => index)

  return attempts.reduce<Promise<T>>(
    (previous, index) =>
      previous.catch((error: unknown) => {
        const isLast = index === PROXY_ATTEMPTS - 1

        if (isLast || !isRepairableThroughAnotherProxy(error)) throw error

        rotate(error, index + 2)

        return attempt()
      }),
    attempt()
  )
}
