import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { AxiosError, AxiosHeaders } from 'axios'
import { PROXY_ATTEMPTS } from 'src/shared/utils/proxy-retry.util'
import { ERROR } from '@transacto/contracts'
import { TransactoPanelSessionApiService } from './transacto-panel-session.api.service'
import type { HttpService } from '@nestjs/axios'
import type { ProxyManagerService } from 'src/shared/proxy'

const EMAIL = 'panel-user'
const PASSWORD = 'panel-secret'
const TOKEN = 'remember-token-value'
const CSRF = 'a'.repeat(64)
const SESSION_ID = 'bidshhaap3ggh01aqccl7oc3e2'

/** The panel embeds its token in a script tag on the payouts page, and nowhere else. */
const payoutsPage = (csrf = CSRF) => ({
  status: 200,
  headers: {},
  data: `<div class="app-payouts-panel"></div>\n<script>\nvar traderPayoutsCsrf = "${csrf}";\n</script>`
})

const loginOk = (cookies: string[] = [`remember_token=${TOKEN}; Max-Age=2592000; path=/`]) => ({
  status: 200,
  data: { status: 'ok' },
  headers: { 'set-cookie': cookies }
})

const keepaliveOk = (active = true) => ({
  status: 200,
  headers: {},
  data: {
    status: 'success',
    message: 'Сесію оновлено',
    data: {
      user_id: '592',
      session_info: { session_active: active, last_activity: 1788431260, session_start: 1788429352 },
      timestamp: 1788431260
    }
  }
})

const redirectToLogin = () => ({ status: 302, data: '<html>login</html>', headers: {} })

/**
 * An exit that accepted the connection and then said nothing.
 *
 * The failure that took the Mini App's rate down: no response at all, so no
 * status to match a list against.
 */
const wentQuiet = () => {
  const error = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED')
  error.config = { headers: new AxiosHeaders() }

  return error
}

/** What Cloudflare answers when it refuses the address, not the credentials. */
const edgeBlock = (status = 403) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: 'attention required' }
  })

describe('TransactoPanelSessionApiService', () => {
  let get: jest.Mock
  let post: jest.Mock
  let requiredAgent: jest.Mock
  let rotateProxy: jest.Mock
  /** The interceptor the service installs, captured so a test can run it. */
  let attachAgent: (config: { httpsAgent?: unknown }) => { httpsAgent?: unknown }
  let service: TransactoPanelSessionApiService

  const originalEmail = process.env.TRANSACTO_PANEL_EMAIL
  const originalPassword = process.env.TRANSACTO_PANEL_PASSWORD

  /** Routes by path, since a session's own calls and a caller's share one mock. */
  const postingTo = (replies: Record<string, unknown>) =>
    jest.fn((path: string) => {
      const reply = replies[path]
      return reply === undefined
        ? Promise.reject(new Error(`unexpected POST ${path}`))
        : Promise.resolve(reply)
    })

  /** Rebuilds against the current `get`/`post`, capturing the interceptor. */
  const buildService = () =>
    new TransactoPanelSessionApiService(
      {
        axiosRef: {
          get,
          post,
          interceptors: {
            request: {
              use: (fn: typeof attachAgent) => {
                attachAgent = fn
              }
            }
          }
        }
      } as unknown as HttpService,
      { requiredAgent, rotateProxy } as unknown as ProxyManagerService
    )

  beforeEach(() => {
    process.env.TRANSACTO_PANEL_EMAIL = EMAIL
    process.env.TRANSACTO_PANEL_PASSWORD = PASSWORD

    requiredAgent = jest.fn().mockReturnValue({ proxy: 'agent' })
    rotateProxy = jest.fn()
    get = jest.fn().mockResolvedValue(payoutsPage())
    post = postingTo({ '/login': loginOk(), '/panels/session_keepalive': keepaliveOk() })
    service = buildService()
  })

  afterEach(() => {
    if (originalEmail === undefined) delete process.env.TRANSACTO_PANEL_EMAIL
    else process.env.TRANSACTO_PANEL_EMAIL = originalEmail
    if (originalPassword === undefined) delete process.env.TRANSACTO_PANEL_PASSWORD
    else process.env.TRANSACTO_PANEL_PASSWORD = originalPassword
  })

  describe('the CSRF token', () => {
    it('is scraped off the payouts page, since nothing hands it over', async () => {
      await expect(service.getCsrfToken()).resolves.toBe(CSRF)
    })

    /** The page is ~11 kB; fetching it per action would cost more than the actions. */
    it('is fetched once and reused', async () => {
      await service.getCsrfToken()
      await service.getCsrfToken()

      expect(get).toHaveBeenCalledTimes(1)
    })

    it('is fetched once when several callers arrive together', async () => {
      await Promise.all([service.getCsrfToken(), service.getCsrfToken(), service.getCsrfToken()])

      expect(get).toHaveBeenCalledTimes(1)
    })

    /**
     * A page that answers without the token is not an outage — their markup
     * changed, and retrying cannot help. The two must not report as one, or an
     * operator waits for an outage to clear that was never happening.
     */
    it('is refused with its own error when the markup no longer carries one', async () => {
      get.mockResolvedValue({ status: 200, headers: {}, data: '<html>no token here</html>' })

      await expect(service.getCsrfToken()).rejects.toMatchObject({
        response: ERROR.TRANSACTO_PANEL.CSRF_UNAVAILABLE
      })
    })

    /**
     * The token belongs to the PHP session. When the panel mints a new one —
     * which it does whenever a `remember_token` arrives without a session — the
     * old token is worthless, and a write refused for a stale token is
     * indistinguishable from one refused for any other reason.
     */
    it('is dropped when the panel issues a new session', async () => {
      await service.getCsrfToken()

      get.mockResolvedValueOnce({
        status: 200,
        headers: { 'set-cookie': [`PHPSESSID=${SESSION_ID}; path=/`] },
        data: 'anything'
      })
      await service.run(() => get())

      const refreshed = 'b'.repeat(64)
      get.mockResolvedValueOnce(payoutsPage(refreshed))
      await expect(service.getCsrfToken()).resolves.toBe(refreshed)
    })
  })

  describe('the cookie presented', () => {
    it('carries the remember_token, which is what the panel actually accepts', async () => {
      await service.run((cookie) => get(cookie))

      expect(get).toHaveBeenCalledWith(`remember_token=${TOKEN}`)
    })

    it('adds the PHP session once the panel has issued one', async () => {
      post = postingTo({
        '/login': loginOk([`remember_token=${TOKEN}; path=/`, `PHPSESSID=${SESSION_ID}; path=/`])
      })
      service = buildService()

      await service.run((cookie) => get(cookie))

      expect(get).toHaveBeenCalledWith(`remember_token=${TOKEN}; PHPSESSID=${SESSION_ID}`)
    })
  })

  describe('an expired session', () => {
    it('is repaired once, transparently to the caller', async () => {
      const call = jest
        .fn()
        .mockResolvedValueOnce(redirectToLogin())
        .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

      await expect(service.run(call)).resolves.toMatchObject({ data: 'fine' })
      expect(post).toHaveBeenCalledTimes(2)
    })

    it('is given up on after one fresh login rather than looping', async () => {
      const call = jest.fn().mockResolvedValue(redirectToLogin())

      await expect(service.run(call)).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(call).toHaveBeenCalledTimes(2)
    })
  })

  describe('keepalive', () => {
    it('reports a live session', async () => {
      await expect(service.isSessionAlive()).resolves.toBe(true)
    })

    it('reports a dead one', async () => {
      post = postingTo({ '/login': loginOk(), '/panels/session_keepalive': keepaliveOk(false) })
      service = buildService()

      await expect(service.isSessionAlive()).resolves.toBe(false)
    })

    /**
     * A question, not an assertion: callers use this to decide whether it is
     * safe to start something, so an unreachable panel has to answer "no"
     * rather than throw into a worker that only wanted to look.
     */
    it('answers no when the panel cannot be reached at all', async () => {
      post = postingTo({ '/login': loginOk() })
      service = buildService()

      await expect(service.isSessionAlive()).resolves.toBe(false)
    })
  })

  describe('the proxy', () => {
    /**
     * Every panel request, not only the session's own: the interceptor sits on
     * the shared axios instance, so the rate and payout services go out through
     * the pool too.
     */
    it('attaches an agent to every request', () => {
      expect(attachAgent({})).toMatchObject({ httpsAgent: { proxy: 'agent' } })
      expect(requiredAgent).toHaveBeenCalledWith('Transacto panel')
    })

    /**
     * A `403` is the edge refusing the address, not the application refusing
     * the credentials — asking again from the same IP cannot help.
     */
    it.each([403, 429, 502, 503, 504])(
      'retries from another address when the call answers %i',
      async (status) => {
        const call = jest
          .fn()
          .mockRejectedValueOnce(edgeBlock(status))
          .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

        await expect(service.run(call)).resolves.toMatchObject({ data: 'fine' })
        expect(rotateProxy).toHaveBeenCalledWith(`Transacto panel HTTP ${status}`, true)
      }
    )

    /**
     * The line that says which of three things refused us. A `503` carrying
     * `cf-ray` came from Cloudflare; one without it never reached the panel at
     * all, and the proxy's exit is the thing to blame.
     */
    it('names who answered, so a proxy failure is not read as an outage', async () => {
      const warnings: string[] = []
      jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation((message: unknown) => void warnings.push(String(message)))

      const call = jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Request failed with status code 503'), {
            isAxiosError: true,
            config: { method: 'get', url: '/panels/payouts?payouts_count' },
            response: {
              status: 503,
              headers: { server: 'cloudflare', 'cf-ray': '9ab1c' },
              data: '<html><title>Just a moment…</title><body>Checking your browser</body></html>'
            }
          })
        )
        .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

      await service.run(call)

      const line = warnings.join('\n')
      expect(line).toContain('cf-ray=9ab1c')
      expect(line).toContain('Checking your browser')
      jest.restoreAllMocks()
    })

    /** A new address almost certainly means a new session, so both are renewed. */
    it('logs in again after a rotation', async () => {
      const call = jest
        .fn()
        .mockRejectedValueOnce(edgeBlock())
        .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

      await service.run(call)

      expect(post).toHaveBeenCalledTimes(2)
    })

    /** An expired session is not an address problem; rotating would waste an IP. */
    it('does not rotate for an expired session', async () => {
      const call = jest
        .fn()
        .mockResolvedValueOnce(redirectToLogin())
        .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

      await service.run(call)

      expect(rotateProxy).not.toHaveBeenCalled()
    })

    /**
     * A failure that is not about the address is still rethrown. Rotating for
     * one would spend an IP on something no address can fix, and hide the real
     * error behind a second identical attempt.
     */
    it('rethrows anything that is neither an expiry nor an address problem', async () => {
      const call = jest.fn().mockRejectedValue(new Error('something broke'))

      await expect(service.run(call)).rejects.toThrow('something broke')
      expect(call).toHaveBeenCalledTimes(1)
      expect(rotateProxy).not.toHaveBeenCalled()
    })

    /**
     * **The one that took production down.** An exit accepted the connection
     * and then said nothing, so there was no status to match against a list —
     * and the rule was a list of statuses. The panel stayed on that address,
     * every call timed out, `GET /tma/rates` answered `503` to every screen in
     * the Mini App, and it only recovered when the same dead exit finally
     * managed a `503` of its own a minute later.
     */
    it('rotates when an address goes quiet, not only when it answers', async () => {
      const call = jest
        .fn()
        .mockRejectedValueOnce(wentQuiet())
        .mockResolvedValueOnce({ status: 200, headers: {}, data: 'fine' })

      await expect(service.run(call)).resolves.toMatchObject({ data: 'fine' })
      expect(rotateProxy).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * The login is the half that had no retry at all, and it is the half that
   * matters most: every other call goes through `run`, which rotates — but with
   * no session there is nothing for `run` to do, and no rate for any screen.
   */
  describe('a login that cannot reach the host', () => {
    it('rotates and tries once more from another address', async () => {
      post.mockReset()
      post
        .mockRejectedValueOnce(wentQuiet())
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValue(payoutsPage())

      await expect(service.getCsrfToken()).resolves.toBe(CSRF)
      expect(rotateProxy).toHaveBeenCalledTimes(1)
    })

    /** Dead exits come in runs, so a second failure is not yet an answer. */
    it('keeps going past a second dead address', async () => {
      post.mockReset()
      post
        .mockRejectedValueOnce(wentQuiet())
        .mockRejectedValueOnce(wentQuiet())
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValue(payoutsPage())

      await expect(service.getCsrfToken()).resolves.toBe(CSRF)
      expect(rotateProxy).toHaveBeenCalledTimes(2)
    })

    it('stops after PROXY_ATTEMPTS rather than working through the pool', async () => {
      post.mockReset()
      post.mockRejectedValue(wentQuiet())

      await expect(service.getCsrfToken()).rejects.toMatchObject({
        response: ERROR.TRANSACTO_PANEL.UNAVAILABLE
      })
      expect(post).toHaveBeenCalledTimes(PROXY_ATTEMPTS)
      expect(rotateProxy).toHaveBeenCalledTimes(PROXY_ATTEMPTS - 1)
    })

    /** A refused login is a credential problem, and another address will not fix it. */
    it('does not rotate when the panel answered and said no', async () => {
      post.mockReset()
      post.mockRejectedValue(new Error('nope'))

      await expect(service.getCsrfToken()).rejects.toBeDefined()
      expect(post).toHaveBeenCalledTimes(1)
      expect(rotateProxy).not.toHaveBeenCalled()
    })
  })

  describe('credentials', () => {
    it('refuses without them, and does not call the panel at all', async () => {
      delete process.env.TRANSACTO_PANEL_PASSWORD

      await expect(service.run(() => get())).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(post).not.toHaveBeenCalled()
    })

    /** Success is the cookie, never the body — the failing body is unobserved. */
    it('rejects a login that sets no remember_token, whatever the body says', async () => {
      post = postingTo({ '/login': { status: 200, data: { status: 'ok' }, headers: {} } })
      service = buildService()

      await expect(service.run(() => get())).rejects.toMatchObject({
        response: ERROR.TRANSACTO_PANEL.UNAVAILABLE
      })
    })
  })
})
