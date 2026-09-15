import { isAxiosError } from 'axios'

/**
 * Naming who refused a panel request, when the status alone cannot.
 *
 * `describeError` answers "which call failed, how" and deliberately drops the
 * response — the right trade almost everywhere. It is the wrong trade here.
 * Three very different things can answer a panel call with the same 5xx, and
 * they need three different fixes:
 *
 * - **Cloudflare**, challenging or rate-limiting us. Its replies carry `cf-ray`
 *   and `server: cloudflare`, and a mitigation adds `cf-mitigated`. The fix is
 *   another address, or looking less like a robot.
 * - **The panel itself**, genuinely unwell. Also behind Cloudflare, so also
 *   carrying `cf-ray` — but the body is theirs, not an interstitial. Nothing to
 *   fix on our side; waiting is the fix.
 * - **The proxy**, refusing or failing to reach the origin. No `cf-ray` at all,
 *   because the response never came from that host.
 *
 * So this prints the headers that separate them plus a short, tag-stripped
 * excerpt of the body. It is deliberately small: enough to tell an operator
 * which of the three happened, not a page dump in a log line.
 *
 * Nothing here can carry a credential — response headers and body only, never
 * `config`. See `describeError` for what happens when a logger is handed a raw
 * axios error.
 */

/** How much of the body is worth keeping. A challenge page announces itself early. */
const EXCERPT_LENGTH = 200

/** Response headers that say who answered, and what they want us to do next. */
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

/**
 * One line describing a failed panel call: the call, the status, who answered,
 * and what they said.
 */
export const describePanelFailure = (error: unknown): string => {
  if (!isAxiosError(error)) return error instanceof Error ? error.message : String(error)

  const method = error.config?.method?.toUpperCase() ?? '?'
  const url = error.config?.url ?? '?'
  const status = error.response?.status ?? 'no response'
  const headers = error.response?.headers ?? {}

  const stated = DIAGNOSTIC_HEADERS.map((name) => [name, headers[name]] as const)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' ')

  const body = excerpt(error.response?.data)

  return [
    `${method} ${url} → ${status} (${error.code ?? 'no code'})`,
    stated,
    body && `body: ${body}`
  ]
    .filter(Boolean)
    .join(' | ')
}
