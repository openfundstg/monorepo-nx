import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { TransactoPanelApiService } from './transacto-panel.api.service'
import { TransactoPanelSessionApiService } from './transacto-panel-session.api.service'
import type { HttpService } from '@nestjs/axios'
import type { ProxyManagerService } from 'src/shared/proxy'

const EMAIL = 'panel-user'
const PASSWORD = 'panel-secret'
const TOKEN = 'remember-token-value'
const RATE_UAH = 44.91

/** The panel's reply to a successful login: the cookie is the part that matters. */
const loginOk = (token = TOKEN) => ({
  status: 200,
  data: { status: 'ok' },
  headers: { 'set-cookie': [`remember_token=${token}; Max-Age=2592000; path=/`] }
})

/** A 200 carrying the quote. The leading space the panel really sends is JSON's problem, not ours. */
const rateOk = (rate = RATE_UAH) => ({ status: 200, data: { rate }, headers: {} })

/** What an expired session looks like: a redirect to the login page, never a 401. */
const redirectToLogin = () => ({
  status: 302,
  data: '<!DOCTYPE html><html>login page</html>',
  headers: { location: '/login' }
})

describe('TransactoPanelApiService', () => {
  let get: jest.Mock
  let post: jest.Mock
  let service: TransactoPanelApiService

  const originalEmail = process.env.TRANSACTO_PANEL_EMAIL
  const originalPassword = process.env.TRANSACTO_PANEL_PASSWORD

  /**
   * Built with a real session service rather than a mock of one.
   *
   * The behaviour under test here is mostly *its* — logging in, presenting the
   * cookie, recognising a `302` — and a stubbed session would assert that this
   * file calls a method, not that a rate survives an expired session.
   */
  const build = () => {
    const httpService = {
      axiosRef: { get, post, interceptors: { request: { use: jest.fn() } } }
    } as unknown as HttpService
    const proxy = {
      requiredAgent: () => undefined,
      rotateProxy: jest.fn()
    } as unknown as ProxyManagerService

    return new TransactoPanelApiService(
      httpService,
      new TransactoPanelSessionApiService(httpService, proxy)
    )
  }

  beforeEach(() => {
    process.env.TRANSACTO_PANEL_EMAIL = EMAIL
    process.env.TRANSACTO_PANEL_PASSWORD = PASSWORD

    get = jest.fn().mockResolvedValue(rateOk())
    post = jest.fn().mockResolvedValue(loginOk())
    service = build()
  })

  afterEach(() => {
    if (originalEmail === undefined) delete process.env.TRANSACTO_PANEL_EMAIL
    else process.env.TRANSACTO_PANEL_EMAIL = originalEmail
    if (originalPassword === undefined) delete process.env.TRANSACTO_PANEL_PASSWORD
    else process.env.TRANSACTO_PANEL_PASSWORD = originalPassword

    jest.restoreAllMocks()
  })

  describe('the happy path', () => {
    it('logs in and returns the published rate', async () => {
      await expect(service.getCurrentRateUah()).resolves.toBe(RATE_UAH)
    })

    it('presents the remember_token, since that alone is what the panel accepts', async () => {
      await service.getCurrentRateUah()

      const [, config] = get.mock.calls[0]
      expect(config.headers.Cookie).toBe(`remember_token=${TOKEN}`)
    })

    /**
     * The form is urlencoded, not JSON, despite the JSON reply — and
     * `remember_me` is what makes the panel issue a 30-day cookie instead of a
     * bare session, which is the difference between logging in monthly and on
     * every request.
     */
    it('posts exactly the four form fields the panel expects', async () => {
      await service.getCurrentRateUah()

      const [path, body, config] = post.mock.calls[0]
      expect(path).toBe('/login')
      expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
        email: EMAIL,
        password: PASSWORD,
        '2fa_code': '',
        remember_me: 'on'
      })
    })

    /** A login per quote would be a login every five minutes, for a 30-day cookie. */
    it('reuses the session across calls', async () => {
      await service.getCurrentRateUah()
      await service.getCurrentRateUah()

      expect(post).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledTimes(2)
    })

    /**
     * Deposits and sales both price through here, so a cold cache with
     * two requests in one tick would otherwise post the login form twice.
     */
    it('logs in once when several callers arrive together', async () => {
      await Promise.all([
        service.getCurrentRateUah(),
        service.getCurrentRateUah(),
        service.getCurrentRateUah()
      ])

      expect(post).toHaveBeenCalledTimes(1)
    })
  })

  describe('an expired session', () => {
    it('retries with a new session, transparently to the caller', async () => {
      get.mockResolvedValueOnce(redirectToLogin())
      post.mockResolvedValueOnce(loginOk(TOKEN)).mockResolvedValueOnce(loginOk('fresh-token'))

      await expect(service.getCurrentRateUah()).resolves.toBe(RATE_UAH)

      // The retry is only worth making because the cookie changed: repeating
      // the request with the session the panel just rejected would fail again.
      const [[, first], [, second]] = get.mock.calls
      expect(first.headers.Cookie).toBe(`remember_token=${TOKEN}`)
      expect(second.headers.Cookie).toBe('remember_token=fresh-token')
    })

    /**
     * The redirect must never be followed. A client that does gets `200` and
     * the login page's HTML, reads `rate` off it as `undefined`, and hands
     * `NaN` to arithmetic on somebody's deposit.
     */
    it('never treats the login page as a quote', async () => {
      get.mockResolvedValue(redirectToLogin())

      await expect(service.getCurrentRateUah()).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('gives up after one fresh login rather than looping', async () => {
      get.mockResolvedValue(redirectToLogin())

      await expect(service.getCurrentRateUah()).rejects.toThrow()
      expect(post).toHaveBeenCalledTimes(2)
    })
  })

  describe('refusing to quote', () => {
    /**
     * Success is the cookie, not the body: the shape of a *failed* login has
     * never been observed, so its absence is the only honest test.
     */
    it('rejects a login that sets no remember_token, whatever the body says', async () => {
      post.mockResolvedValue({ status: 200, data: { status: 'ok' }, headers: {} })

      await expect(service.getCurrentRateUah()).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(get).not.toHaveBeenCalled()
    })

    it('refuses without credentials, and does not call the panel at all', async () => {
      delete process.env.TRANSACTO_PANEL_PASSWORD

      await expect(build().getCurrentRateUah()).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )
      expect(post).not.toHaveBeenCalled()
    })

    it.each([
      ['a missing field', {}],
      ['a string', { rate: '44.91' }],
      ['zero', { rate: 0 }],
      ['a negative price', { rate: -1 }],
      ['null', null]
    ])('refuses a body carrying %s', async (_case, data) => {
      get.mockResolvedValue({ status: 200, data, headers: {} })

      await expect(service.getCurrentRateUah()).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('turns a transport failure into a refusal, not a crash', async () => {
      get.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.getCurrentRateUah()).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    /** A failed login must not leave a poisoned session behind for the next caller. */
    it('recovers on a later call once the panel comes back', async () => {
      post.mockRejectedValueOnce(new Error('ECONNRESET'))
      await expect(service.getCurrentRateUah()).rejects.toThrow()

      await expect(service.getCurrentRateUah()).resolves.toBe(RATE_UAH)
    })
  })

  /**
   * The password and the session token are both credentials. An axios failure
   * carries the whole request — form body included — so logging the raw error
   * would print the panel password in plaintext on every upstream blip.
   */
  describe('what reaches the logs', () => {
    const captureLogs = (): string[] => {
      const lines: string[] = []
      const record = (message: unknown) => void lines.push(String(message))

      for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation(record)
      }

      return lines
    }

    it('never prints the password or the token on a healthy call', async () => {
      const lines = captureLogs()

      await service.getCurrentRateUah()

      expect(lines.join('\n')).not.toContain(PASSWORD)
      expect(lines.join('\n')).not.toContain(TOKEN)
    })

    it('never prints them when the panel fails either', async () => {
      const lines = captureLogs()
      const failure = Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        config: { method: 'post', url: '/login', data: `password=${PASSWORD}` },
        response: { status: 500 }
      })
      post.mockRejectedValue(failure)

      await expect(service.getCurrentRateUah()).rejects.toThrow()

      expect(lines.join('\n')).not.toContain(PASSWORD)
    })
  })
})
