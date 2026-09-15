import { ERROR } from '@transacto/contracts'
import { UnauthorizedException } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { AdminSessionService } from 'src/modules/auth/services/admin-session.service'
import { ADMIN_SESSION } from 'src/modules/auth/constants/admin-session.constants'
import { CSRF_COOKIE_NAME } from 'src/modules/auth/guards/csrf.guard'

/** Enough of ioredis for the session paths, with the calls recorded. */
const redisStub = () => {
  const store = new Map<string, string>()

  return {
    store,
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ttl: jest.fn(async () => 3600),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, String(next))
      return next
    }),
    expire: jest.fn(async () => 1)
  }
}

describe('AdminSessionService', () => {
  const ADMIN_KEYS = ['ADMIN_USERNAME', 'ADMIN_PASSWORD'] as const

  /**
   * The keys are deleted rather than `process.env` being replaced wholesale.
   *
   * `src/environments` exports `process.env` itself, so the service holds a
   * reference to that exact object — swapping `process.env` for a copy leaves
   * the service reading the old one, and every "no credentials configured"
   * assertion then passes against values a previous test set.
   */
  afterEach(() => {
    for (const key of ADMIN_KEYS) delete process.env[key]
    jest.restoreAllMocks()
  })

  const service = (redis = redisStub()) => ({
    redis,
    service: new AdminSessionService(redis as unknown as Redis)
  })

  describe('verifyCredentials', () => {
    it('accepts the configured pair', () => {
      process.env.ADMIN_USERNAME = 'oleg'
      process.env.ADMIN_PASSWORD = 'correct horse battery staple'

      expect(service().service.verifyCredentials('oleg', 'correct horse battery staple')).toBe(
        true
      )
    })

    it('rejects a wrong password', () => {
      process.env.ADMIN_USERNAME = 'oleg'
      process.env.ADMIN_PASSWORD = 'correct horse battery staple'

      expect(service().service.verifyCredentials('oleg', 'nope')).toBe(false)
    })

    /**
     * The one that matters. With no credentials configured there is nothing to
     * authenticate against, and a `false`-returning implementation that later
     * grew an "or the env is empty" branch would publish the whole panel.
     */
    it('refuses every login when the environment carries no credentials', () => {
      delete process.env.ADMIN_USERNAME
      delete process.env.ADMIN_PASSWORD

      expect(() => service().service.verifyCredentials('anyone', 'anything')).toThrow(
        UnauthorizedException
      )
    })

    it('refuses when only half the pair is configured', () => {
      process.env.ADMIN_USERNAME = 'oleg'
      delete process.env.ADMIN_PASSWORD

      expect(() => service().service.verifyCredentials('oleg', '')).toThrow(UnauthorizedException)
    })

    /**
     * `timingSafeEqual` throws on a length mismatch, which would leak the
     * password's length as an exception rather than a `false`. Hashing first is
     * what makes every comparison the same 32 bytes.
     */
    it('compares values of different lengths without throwing', () => {
      process.env.ADMIN_USERNAME = 'oleg'
      process.env.ADMIN_PASSWORD = 'a-long-configured-password'

      expect(service().service.verifyCredentials('oleg', 'x')).toBe(false)
    })
  })

  describe('sessions', () => {
    it('stores the principal under a random id and resolves it back', async () => {
      const { service: sut } = service()
      const created = await sut.create('oleg')

      expect(created.sessionId).toHaveLength(ADMIN_SESSION.ID_BYTES * 2)
      expect(created.csrfToken).toHaveLength(ADMIN_SESSION.CSRF_BYTES * 2)

      const resolved = await sut.resolve(created.sessionId)
      expect(resolved).toEqual({
        username: 'oleg',
        sessionId: created.sessionId,
        csrfToken: created.csrfToken
      })
    })

    it('issues a different id and token every time', async () => {
      const { service: sut } = service()
      const [first, second] = await Promise.all([sut.create('oleg'), sut.create('oleg')])

      expect(first.sessionId).not.toEqual(second.sessionId)
      expect(first.csrfToken).not.toEqual(second.csrfToken)
    })

    it('resolves an unknown session to null rather than throwing', async () => {
      expect(await service().service.resolve('nope')).toBeNull()
    })

    it('revokes a session so it stops resolving', async () => {
      const { service: sut } = service()
      const created = await sut.create('oleg')

      await sut.revoke(created.sessionId)

      expect(await sut.resolve(created.sessionId)).toBeNull()
    })

    /**
     * A value only this service writes; if it comes back unparseable the store
     * is corrupt, and answering "no session" plus clearing the key is safer
     * than a 500 on every request the operator makes.
     */
    it('treats an unparseable stored value as no session and clears it', async () => {
      const { redis, service: sut } = service()
      redis.store.set('admin:session:broken', 'not json')

      expect(await sut.resolve('broken')).toBeNull()
      expect(redis.del).toHaveBeenCalledWith('admin:session:broken')
    })
  })

  describe('login rate limiting', () => {
    it('permits an address with no recorded failures', async () => {
      await expect(service().service.assertNotLockedOut('1.2.3.4')).resolves.toBeUndefined()
    })

    it('locks out once the attempts are spent', async () => {
      const { service: sut } = service()

      for (let attempt = 0; attempt < ADMIN_SESSION.MAX_LOGIN_ATTEMPTS; attempt += 1)
        await sut.recordFailedAttempt('1.2.3.4')

      await expect(sut.assertNotLockedOut('1.2.3.4')).rejects.toMatchObject({
        response: ERROR.ADMIN.TOO_MANY_ATTEMPTS
      })
    })

    /**
     * The window is refreshed on every failure, so an attacker cannot pace
     * themselves to keep a counter alive while it expires underneath them.
     */
    it('refreshes the window on each failure', async () => {
      const { redis, service: sut } = service()

      await sut.recordFailedAttempt('1.2.3.4')
      await sut.recordFailedAttempt('1.2.3.4')

      expect(redis.expire).toHaveBeenCalledTimes(2)
      expect(redis.expire).toHaveBeenLastCalledWith(
        'admin:login:attempts:1.2.3.4',
        ADMIN_SESSION.LOGIN_WINDOW_SECONDS
      )
    })

    it('clears the counter on a successful login', async () => {
      const { service: sut } = service()
      await sut.recordFailedAttempt('1.2.3.4')
      await sut.clearAttempts('1.2.3.4')

      await expect(sut.assertNotLockedOut('1.2.3.4')).resolves.toBeUndefined()
    })
  })

  describe('cookies', () => {
    const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() })

    it('scopes the session cookie to / and the CSRF cookie to /api/admin', () => {
      // Both scopes are load-bearing. The session cookie has to reach
      // `/socket.io`, which is outside the API prefix. The CSRF cookie must NOT
      // reach the Mini App on this same origin, or `CsrfGuard` would start
      // failing every Mini App write the moment an operator logged in.
      const res = response()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service().service.attachCookies(res as any, 'session-id', 'csrf-token')

      const [sessionCall, csrfCall] = res.cookie.mock.calls

      expect(sessionCall[0]).toBe(ADMIN_SESSION.COOKIE_NAME)
      expect(sessionCall[2]).toMatchObject({ httpOnly: true, path: '/', sameSite: 'lax' })

      expect(csrfCall[0]).toBe(CSRF_COOKIE_NAME)
      expect(csrfCall[2]).toMatchObject({
        httpOnly: false,
        path: ADMIN_SESSION.CSRF_COOKIE_PATH
      })
    })

    it('clears both cookies with the attributes they were set with', () => {
      const res = response()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service().service.clearCookies(res as any)

      expect(res.clearCookie).toHaveBeenCalledTimes(2)
      expect(res.clearCookie.mock.calls[0][1]).toMatchObject({ path: '/' })
      expect(res.clearCookie.mock.calls[1][1]).toMatchObject({
        path: ADMIN_SESSION.CSRF_COOKIE_PATH
      })
    })
  })

  describe('readCookie', () => {
    it('reads one cookie out of a header carrying several', () => {
      const request = {
        headers: { cookie: 'other=1; admin_session=abc123; csrf-token=xyz' }
      }

      expect(service().service.readCookie(request, ADMIN_SESSION.COOKIE_NAME)).toBe('abc123')
    })

    it('returns null when the header is absent', () => {
      expect(service().service.readCookie({ headers: {} }, ADMIN_SESSION.COOKIE_NAME)).toBeNull()
    })

    it('does not match a cookie whose name merely ends with the one asked for', () => {
      const request = { headers: { cookie: 'not_admin_session=wrong' } }

      expect(service().service.readCookie(request, ADMIN_SESSION.COOKIE_NAME)).toBeNull()
    })
  })
})
