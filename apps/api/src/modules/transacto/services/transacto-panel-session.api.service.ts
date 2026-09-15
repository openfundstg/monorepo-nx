import { HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { isAxiosError, type AxiosResponse } from 'axios'
import { ERROR } from '@transacto/contracts'
import {
  TransactoPanelCookie,
  TransactoPanelKeepaliveResponse,
  TransactoPanelLoginRequest,
  TransactoPanelLoginResponse
} from 'src/shared/interfaces/transacto-panel.interface'
import { ProxyManagerService } from 'src/shared/proxy'
import { describePanelFailure } from 'src/modules/transacto/utils'
import { describeError } from 'src/shared/utils/describe-error.util'
import { readSetCookie } from 'src/shared/utils/set-cookie.util'
import {
  isRepairableThroughAnotherProxy,
  PROXY_ATTEMPTS
} from 'src/shared/utils/proxy-retry.util'
import environments from 'src/environments'

const LOGIN_PATH = '/login'
const KEEPALIVE_PATH = '/panels/session_keepalive'
const PAYOUTS_PATH = '/panels/payouts'

/**
 * The panel's own page embeds its CSRF token in a script tag:
 *
 *     var traderPayoutsCsrf = "44bc54…1542a";
 *
 * There is no endpoint that hands it over, so scraping the page is the only
 * way to obtain it. Anchored on the variable name and a hex value so a
 * different string on the same page cannot be mistaken for one.
 */
const CSRF_PATTERN = /traderPayoutsCsrf\s*=\s*["']([0-9a-f]{32,})["']/i

/** Who we are to the proxy pool, for its log lines. */
const PROXY_CONSUMER = 'Transacto panel'

/** How one attempt ended: with a response, or with a reason to try once more. */
type Attempt<T> =
  | { readonly kind: 'answered'; readonly response: AxiosResponse<T> }
  | { readonly kind: 'expired' }
  | { readonly kind: 'blocked'; readonly reason: string }

/** What one authenticated call needs presented to the panel. */
interface PanelSession {
  /** Thirty-day cookie. Sufficient on its own — it mints a PHP session when needed. */
  readonly rememberToken: string
  /** The PHP session the panel last issued us, once it has issued one. */
  readonly phpSessionId: string | null
  /** Bound to {@link phpSessionId}; dropped whenever that changes. */
  readonly csrfToken: string | null
}

/**
 * One panel session, shared by everything that talks to the panel.
 *
 * It exists because reading the rate and settling a payout are the same
 * conversation with the same server, and they had better not be two logins with
 * two sessions on one trader account. Everything that is *about the connection*
 * rather than about payouts or rates lives here: the credentials, the cookies,
 * the CSRF token, and the one rule this codebase has already been bitten by —
 * **an expired session is a `302` to `/login`, never a `401`.**
 *
 * Three things are worth knowing before changing it.
 *
 * - **The `302` is repairable and nothing else is.** {@link run} retries exactly
 *   once, through a fresh login. A timeout or a 500 is an outage, and a second
 *   identical request cannot fix it.
 * - **The CSRF token belongs to the PHP session.** When the panel mints a new
 *   `PHPSESSID` — which it does the moment a `remember_token` is presented
 *   without one — the token scraped under the old session is discarded rather
 *   than reused, because a request rejected for a stale token looks exactly like
 *   one rejected for anything else and would be diagnosed as neither.
 * - **Nothing here is persisted.** The credentials live in memory only; putting
 *   a thirty-day cookie in Redis would leave a live credential at rest to save
 *   one POST per restart.
 */
@Injectable()
export class TransactoPanelSessionApiService {
  private readonly logger = new Logger(TransactoPanelSessionApiService.name)

  private session: PanelSession | null = null

  /**
   * Deduplicates concurrent logins. The rate, the payout book and a receipt
   * upload can all miss a cold cache in the same tick, and the panel's login
   * form should not be posted three times for it.
   */
  private loginInFlight: Promise<PanelSession> | null = null

  /** The same deduplication for the page scrape that yields the CSRF token. */
  private csrfInFlight: Promise<string> | null = null

  constructor(
    private readonly httpService: HttpService,
    private readonly proxy: ProxyManagerService
  ) {
    // Every panel request goes out through the pool, including ones made by the
    // rate and payout services on this same axios instance. Attached per
    // request rather than baked into the client, so a rotation applies to the
    // very next call.
    this.httpService.axiosRef.interceptors.request.use((config) => {
      config.httpsAgent = this.proxy.requiredAgent(PROXY_CONSUMER)

      return config
    })
  }

  /**
   * Runs one authenticated call, repairing a dead session once.
   *
   * `call` is handed the `Cookie` header to present and must return the axios
   * response, not a parsed body — the status is how expiry is recognised, and a
   * caller that had already unwrapped the body could not report it.
   */
  async run<T>(call: (cookie: string) => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
    const first = await this.attempt(call, await this.authenticate())
    if (first.kind === 'answered') return first.response

    if (first.kind === 'blocked') {
      // A new address means the old session is very likely gone with it, so the
      // rotation and the re-login happen together rather than one at a time.
      this.proxy.rotateProxy(`Transacto panel ${first.reason}`, true)
    } else {
      this.logger.log('Panel session was rejected; logging in again')
    }

    this.forget()

    const second = await this.attempt(call, await this.authenticate())
    if (second.kind === 'answered') return second.response

    this.logger.error(`Panel still refusing after a fresh login and proxy (${second.kind})`)
    throw new ServiceUnavailableException(ERROR.TRANSACTO_PANEL.UNAVAILABLE)
  }

  /**
   * One call, classified.
   *
   * Anything that is neither an expiry nor an edge block is rethrown: a
   * timeout, a 500 or an unparseable body is an outage, and a second identical
   * request from a second address cannot fix it.
   */
  private async attempt<T>(
    call: (cookie: string) => Promise<AxiosResponse<T>>,
    session: PanelSession
  ): Promise<Attempt<T>> {
    try {
      const response = await call(this.cookieHeader(session))
      this.absorb(session, response)

      return response.status === HttpStatus.FOUND
        ? { kind: 'expired' }
        : { kind: 'answered', response }
    } catch (error: unknown) {
      // **A timeout counts, and it did not used to.** The rule was a list of
      // statuses, so a borrowed exit that accepted the connection and then said
      // nothing threw straight past the retry — and because a login does not
      // rotate either, the panel stayed on that address until some *other*
      // consumer of the pool happened to rotate it. In production that was
      // twenty seconds of timeouts, no rate on any screen, and a recovery that
      // only came when the same exit finally managed a 503.
      if (!isRepairableThroughAnotherProxy(error)) throw error

      // Logged here rather than where it is handled, because this is the only
      // place holding the response: whether `cf-ray` is present is what says
      // Cloudflare refused us rather than the proxy's exit dying under us, and
      // those have different fixes.
      this.logger.warn(`Panel call failed, retrying from another address: ${describePanelFailure(error)}`)

      const status = isAxiosError(error) ? error.response?.status : undefined

      return { kind: 'blocked', reason: status === undefined ? 'no response' : `HTTP ${status}` }
    }
  }

  /**
   * The CSRF token every panel write requires, scraped from the payouts page.
   *
   * Cached for as long as the session it belongs to. The page is roughly
   * eleven kilobytes, so fetching it per action would cost more than every
   * action put together.
   */
  async getCsrfToken(): Promise<string> {
    const existing = this.session?.csrfToken
    if (existing) return existing

    this.csrfInFlight ??= this.fetchCsrfToken().finally(() => {
      this.csrfInFlight = null
    })

    return this.csrfInFlight
  }

  /**
   * Whether the panel still considers our session live, and refreshes its idle
   * clock in passing.
   *
   * Worth having as its own call because it is the only way to ask that
   * question without touching something that moves money — a worker can check
   * before reserving somebody's payout rather than discovering the problem with
   * a half-finished reservation.
   */
  async isSessionAlive(): Promise<boolean> {
    const response = await this.run<TransactoPanelKeepaliveResponse>((cookie) =>
      this.httpService.axiosRef.post(
        KEEPALIVE_PATH,
        { action: 'keepalive' },
        { headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json' } }
      )
    ).catch((error: unknown) => {
      this.logger.error(`Panel keepalive failed: ${describeError(error)}`)
      return null
    })

    return response?.data?.data?.session_info?.session_active === true
  }

  /** Drops everything, forcing the next call through a fresh login. */
  forget(): void {
    this.session = null
  }

  /** The current session, logging in first if there is not one. */
  private async authenticate(): Promise<PanelSession> {
    const existing = this.session
    if (existing !== null) return existing

    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null
    })

    return this.loginInFlight
  }

  private cookieHeader(session: PanelSession): string {
    const cookies = [`${TransactoPanelCookie.REMEMBER_TOKEN}=${session.rememberToken}`]
    if (session.phpSessionId)
      cookies.push(`${TransactoPanelCookie.SESSION}=${session.phpSessionId}`)

    return cookies.join('; ')
  }

  /**
   * Keeps a `PHPSESSID` the panel just issued, and drops the CSRF token with it.
   *
   * The token was minted under the previous session and is worthless under the
   * new one. Discarding it here — rather than when a write is refused — is what
   * keeps a stale-token refusal from ever being seen, since it cannot be told
   * apart from any other refusal by looking at the response.
   */
  private absorb(used: PanelSession, response: AxiosResponse): void {
    const issued = readSetCookie(response.headers['set-cookie'], TransactoPanelCookie.SESSION)
    if (issued === null || issued === used.phpSessionId) return
    if (this.session !== used) return

    this.session = { ...used, phpSessionId: issued, csrfToken: null }
  }

  /**
   * Drops `used`, but only if it is still the session in hand.
   *
   * A concurrent call may already have replaced it with a working one, and
   * clearing that would send every caller back through the login form for a
   * session that was never the problem.
   */
  private invalidate(used: PanelSession): void {
    if (this.session === used) this.session = null
  }

  private async fetchCsrfToken(): Promise<string> {
    const response = await this.run<string>((cookie) =>
      this.httpService.axiosRef.get(PAYOUTS_PATH, {
        headers: { Cookie: cookie, Accept: 'text/html' }
      })
    )

    const matched = CSRF_PATTERN.exec(String(response.data ?? ''))

    if (matched === null) {
      // The token is a credential; the page around it is not, but printing
      // eleven kilobytes of it would bury the line that matters.
      this.logger.error('Panel payouts page carried no CSRF token — its markup may have changed')
      throw new ServiceUnavailableException(ERROR.TRANSACTO_PANEL.CSRF_UNAVAILABLE)
    }

    const [, csrfToken] = matched
    const current = this.session
    if (current !== null) this.session = { ...current, csrfToken }

    return csrfToken
  }

  /**
   * Posts the panel's login form and keeps the cookies it returns.
   *
   * **Success is the presence of `remember_token`, not the response body.** The
   * body of a *failed* login has never been observed — one wrong password
   * against the production account risks locking the trader everything here
   * runs on — so branching on `status` would mean recognising one half of a
   * pair. The cookie is the thing actually needed, and its absence is the
   * honest test for every way this can fail, including ones nobody has seen yet.
   */
  /**
   * Posts the login form, once more from another address if the first failure
   * was about the address.
   *
   * **The login is where the pool has to be rotated, and it never was.** Every
   * other panel call goes through {@link run}, which rotates and retries; a
   * login that failed simply threw, so a dead exit blocked every attempt to get
   * a session — and with no session there is no rate, and `GET /tma/rates`
   * answers `503` to every screen in the Mini App. Production recovered from
   * exactly that only because an unrelated consumer of the shared pool rotated
   * it a minute later.
   *
   * {@link PROXY_ATTEMPTS} addresses, not two. Dead exits come in runs — a
   * `CONNECT` through one of this pool's ports answers `503` for every
   * destination alike — and a login that tried one more and gave up is how the
   * rate went missing from every Mini App screen for a minute and a half.
   */
  private async postLogin(
    form: TransactoPanelLoginRequest
  ): Promise<AxiosResponse<TransactoPanelLoginResponse>> {
    const body = new URLSearchParams(Object.entries(form)).toString()
    const post = (): Promise<AxiosResponse<TransactoPanelLoginResponse>> =>
      this.httpService.axiosRef.post<TransactoPanelLoginResponse>(LOGIN_PATH, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        }
      })

    const attempts = Array.from({ length: PROXY_ATTEMPTS }, (_unused, index) => index)

    return attempts.reduce<Promise<AxiosResponse<TransactoPanelLoginResponse>>>(
      (previous, index) =>
        previous.catch((error: unknown) => {
          // `describeError` deliberately drops the request config. The raw error
          // carries this form in `config.data` — the panel password in plaintext.
          this.logger.error(
            `Panel login failed on address ${index + 1} of ${PROXY_ATTEMPTS}: ` +
              describeError(error)
          )

          if (index === PROXY_ATTEMPTS - 1 || !isRepairableThroughAnotherProxy(error))
            throw new ServiceUnavailableException(ERROR.TRANSACTO_PANEL.UNAVAILABLE)

          this.proxy.rotateProxy('Transacto panel login could not reach the host', true)

          return post()
        }),
      post()
    )
  }

  private async login(): Promise<PanelSession> {
    const email = environments.TRANSACTO_PANEL_EMAIL
    const password = environments.TRANSACTO_PANEL_PASSWORD

    if (!email || !password) {
      // Configuration, not an outage — but indistinguishable to a client, which
      // either gets an answer or does not. The log line is where the difference
      // has to be visible, so an operator is not left waiting for a panel
      // failure to clear.
      this.logger.error(
        'TRANSACTO_PANEL_EMAIL / TRANSACTO_PANEL_PASSWORD are not set — the panel is unreachable'
      )
      throw new ServiceUnavailableException(ERROR.TRANSACTO_PANEL.UNAVAILABLE)
    }

    const form: TransactoPanelLoginRequest = {
      email,
      password,
      '2fa_code': '',
      remember_me: 'on'
    }

    const response = await this.postLogin(form)

    const rememberToken = readSetCookie(
      response.headers['set-cookie'],
      TransactoPanelCookie.REMEMBER_TOKEN
    )

    if (rememberToken === null) {
      this.logger.error(
        `Panel login returned ${response.status} without a ${TransactoPanelCookie.REMEMBER_TOKEN} ` +
          'cookie — treating it as a rejected login'
      )
      throw new ServiceUnavailableException(ERROR.TRANSACTO_PANEL.UNAVAILABLE)
    }

    const session: PanelSession = {
      rememberToken,
      phpSessionId: readSetCookie(response.headers['set-cookie'], TransactoPanelCookie.SESSION),
      csrfToken: null
    }

    this.logger.log('Authenticated with the Transacto panel')
    this.session = session

    return session
  }
}
