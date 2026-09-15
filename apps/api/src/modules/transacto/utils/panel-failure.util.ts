import { isAxiosError } from 'axios'

/**
 * Naming who refused a panel call, when the status alone cannot.
 *
 * `describeError` answers "which call failed, and how", and deliberately drops
 * the response — the right trade almost everywhere, and the reason a trader's
 * `X-API-TOKEN` stopped appearing in logs. It is the wrong trade here, because
 * three different things answer this host with the same 5xx and each needs a
 * different fix:
 *
 * - **Cloudflare**, challenging or throttling us. Carries `cf-ray` and
 *   `server: cloudflare`; a mitigation adds `cf-mitigated`. Fixed by another
 *   address, or by looking less like a robot.
 * - **The panel**, genuinely unwell. Also behind Cloudflare, so also carrying
 *   `cf-ray` — but the body is theirs rather than an interstitial. Waiting is
 *   the fix; rotating addresses is not.
 * - **The proxy**, whose exit died mid-request. **No `cf-ray` at all**, because
 *   the response never came from that host. This is the common one on a
 *   residential pool, and it is invisible without this line.
 *
 * Response headers and a short body excerpt only. Nothing from `config`, which
 * is where the credentials are.
 */

/** A challenge page announces itself in the first line; this is generous. */
const EXCERPT_LENGTH = 200

/** The headers that say who answered, and what they want us to do next. */
const DIAGNOSTIC_HEADERS = ['server', 'cf-ray', 'cf-mitigated', 'retry-after', 'content-type']

const excerpt = (data: unknown): string => {
  if (typeof data !== 'string' || data.length === 0) return ''

  const text = data
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}

export const describePanelFailure = (error: unknown): string => {
  if (!isAxiosError(error)) return error instanceof Error ? error.message : String(error)

  const method = error.config?.method?.toUpperCase() ?? '?'
  const url = error.config?.url ?? '?'
  const status = error.response?.status ?? 'no response'
  const headers = error.response?.headers ?? {}

  const answered = DIAGNOSTIC_HEADERS.map((name) => [name, headers[name]] as const)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' ')

  const body = excerpt(error.response?.data)

  return [
    `${method} ${url} → ${status} (${error.code ?? 'no code'})`,
    answered || 'no diagnostic headers — the response did not come from the panel',
    body && `body: ${body}`
  ]
    .filter(Boolean)
    .join(' | ')
}
