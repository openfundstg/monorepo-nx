import { ERROR } from '@transacto/contracts'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { APP_GUARD, APP_PIPE } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import {
  ADMIN_SESSION,
  AdminAuthService,
  AdminSessionService,
  CsrfGuard,
  CSRF_HEADER_NAME,
  UserTypesGuard
} from 'src/modules/auth'
import { TmaAuthService } from 'src/modules/auth/services/tma-auth.service'
import { TraderAuthService } from 'src/modules/auth/services/trader-auth.service'
import { AdminAuthController } from 'src/modules/admin/controllers/admin-auth.controller'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { AdminLoginService } from 'src/modules/admin/services/admin-login.service'
import { AdminAuditLogDbService } from 'src/modules/repositories/admin-db'

/**
 * The security boundary, end to end over real HTTP.
 *
 * Everything else here constructs services directly, which cannot see the part
 * that actually protects the panel: the global guard chain, the cookie
 * attributes, and the CSRF double-submit that only switches on because the
 * login response set a cookie. Those are four components agreeing with each
 * other, and every one of them type-checks while disagreeing.
 *
 * A real Nest app on a real port, driven with `fetch`. No supertest — Node has
 * had `fetch` for years and the assertions here are about headers and status
 * codes, which it reports perfectly well.
 */
describe('Admin authentication over HTTP', () => {
  let app: INestApplication
  let baseUrl: string

  const store = new Map<string, string>()

  const redisStub = {
    set: async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    },
    get: async (key: string) => store.get(key) ?? null,
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    ttl: async () => 3600,
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, String(next))
      return next
    },
    expire: async () => 1
  } as unknown as Redis

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = 'oleg'
    process.env.ADMIN_PASSWORD = 'a-real-password'
    // `Secure` cookies are dropped over plain HTTP, which is what this test
    // speaks — the service reads NODE_ENV to decide, so say so.
    process.env.NODE_ENV = 'development'

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        { provide: REDIS_CLIENT, useValue: redisStub },
        AdminSessionService,
        AdminAuthService,
        AdminLoginService,
        AdminAuditService,
        // The audit trail and the socket fan-out are not what this test is
        // about, and both are exercised elsewhere — but the stub returns a
        // document shaped like a real one. Returning `{}` still passed, because
        // `AdminAuditService.record` swallows its own failures by design; it
        // just filled the run with ERROR lines for somebody to chase later.
        {
          provide: AdminAuditLogDbService,
          useValue: {
            append: async (entry: Record<string, unknown>) => ({
              ...entry,
              _id: { toString: () => 'audit-id' },
              createdAt: new Date()
            })
          }
        },
        { provide: AdminGateway, useValue: { emit: () => undefined } },
        { provide: TraderAuthService, useValue: { authenticate: async () => undefined } },
        { provide: TmaAuthService, useValue: { authenticate: async () => undefined } },
        // Registered exactly as `AppModule` does, in the same order — CSRF
        // first, then the access decorators.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: UserTypesGuard },
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
          })
        }
      ]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.listen(0)
    baseUrl = await app.getUrl()
  })

  afterAll(async () => {
    await app?.close()
    delete process.env.ADMIN_USERNAME
    delete process.env.ADMIN_PASSWORD
  })

  beforeEach(() => store.clear())

  const login = (username = 'oleg', password = 'a-real-password') =>
    fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })

  /** The cookie jar a browser would keep, as a single `Cookie` header. */
  const cookiesFrom = (response: Response): string =>
    response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')

  const cookieAttributes = (response: Response, name: string): string =>
    response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`)) ?? ''

  describe('login', () => {
    it('refuses a wrong password with the shared error code', async () => {
      const response = await login('oleg', 'wrong')

      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: ERROR.ADMIN.INVALID_CREDENTIALS.code
      })
    })

    /**
     * Both halves answer identically. Distinguishing them would tell an
     * attacker they had found the one valid username.
     */
    it('answers a wrong username the same way as a wrong password', async () => {
      const [badUser, badPassword] = await Promise.all([
        login('someone-else', 'a-real-password').then((r) => r.json()),
        login('oleg', 'wrong').then((r) => r.json())
      ])

      expect(badUser).toEqual(badPassword)
    })

    it('rejects a malformed body before it reaches the handler', async () => {
      const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'oleg', password: 'x', extra: 'field' })
      })

      // `forbidNonWhitelisted` — an unexpected property is a 400, not a
      // silently ignored one.
      expect(response.status).toBe(400)
    })

    it('issues both cookies and returns the CSRF token in the body', async () => {
      const response = await login()

      expect(response.status).toBe(200)

      const body = (await response.json()) as { username: string; csrfToken: string }
      expect(body.username).toBe('oleg')
      expect(body.csrfToken).toHaveLength(ADMIN_SESSION.CSRF_BYTES * 2)

      const session = cookieAttributes(response, ADMIN_SESSION.COOKIE_NAME)
      const csrf = cookieAttributes(response, 'csrf-token')

      // The session cookie is unreadable by script and scoped to `/` so the
      // Socket.IO handshake carries it.
      expect(session).toMatch(/HttpOnly/i)
      expect(session).toMatch(/Path=\//)

      // The CSRF cookie is the opposite on both counts, and its narrow path is
      // load-bearing: the Mini App shares this origin, and `CsrfGuard` enforces
      // wherever the cookie is sent.
      expect(csrf).not.toMatch(/HttpOnly/i)
      expect(csrf).toMatch(new RegExp(`Path=${ADMIN_SESSION.CSRF_COOKIE_PATH}`))
    })

    /** The session id itself must never appear in a body script can read. */
    it('does not put the session id in the response body', async () => {
      const response = await login()
      const raw = JSON.stringify(await response.json())
      const sessionId = cookiesFrom(response).match(/admin_session=([^;]+)/)?.[1]

      expect(sessionId).toBeDefined()
      expect(raw).not.toContain(sessionId)
    })

    it('locks an address out after enough failures', async () => {
      for (let attempt = 0; attempt < ADMIN_SESSION.MAX_LOGIN_ATTEMPTS; attempt += 1)
        await login('oleg', 'wrong')

      // Even the correct password is refused while the lockout stands.
      const response = await login()

      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: ERROR.ADMIN.TOO_MANY_ATTEMPTS.code
      })
    })
  })

  describe('the session guard', () => {
    it('refuses an unauthenticated read', async () => {
      const response = await fetch(`${baseUrl}/api/admin/auth/me`)

      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: ERROR.ADMIN.NO_SESSION.code })
    })

    it('admits a request carrying the session cookie', async () => {
      const cookies = cookiesFrom(await login())
      const response = await fetch(`${baseUrl}/api/admin/auth/me`, { headers: { cookie: cookies } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ username: 'oleg' })
    })

    it('refuses a session that has been revoked', async () => {
      const cookies = cookiesFrom(await login())
      store.clear()

      const response = await fetch(`${baseUrl}/api/admin/auth/me`, { headers: { cookie: cookies } })

      expect(response.status).toBe(401)
    })
  })

  describe('CSRF', () => {
    /**
     * The reason `CsrfGuard` exists at all. It was inert for the whole life of
     * this codebase because every caller authenticated by header; the admin
     * cookie is the first ambient credential, and this is the test that says
     * the guard woke up.
     */
    it('refuses a state-changing request that does not echo the token', async () => {
      const cookies = cookiesFrom(await login())

      const response = await fetch(`${baseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookies }
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: ERROR.AUTH.CSRF_TOKEN_MISMATCH.code
      })
    })

    it('refuses a request echoing the wrong token', async () => {
      const cookies = cookiesFrom(await login())

      const response = await fetch(`${baseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookies, [CSRF_HEADER_NAME]: 'a'.repeat(64) }
      })

      expect(response.status).toBe(403)
    })

    it('accepts a request echoing the token from the login response', async () => {
      const response = await login()
      const cookies = cookiesFrom(response)
      const { csrfToken } = (await response.json()) as { csrfToken: string }

      const loggedOut = await fetch(`${baseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookies, [CSRF_HEADER_NAME]: csrfToken }
      })

      expect(loggedOut.status).toBe(204)

      // And the session is genuinely gone afterwards.
      const after = await fetch(`${baseUrl}/api/admin/auth/me`, { headers: { cookie: cookies } })
      expect(after.status).toBe(401)
    })

    /**
     * Login must stay exempt. A browser holding a stale CSRF cookie from an
     * expired session would otherwise be refused at the very form that fixes
     * it — locked out by the protection rather than by the credentials.
     */
    it('lets a login through while a stale CSRF cookie is present', async () => {
      const stale = cookiesFrom(await login())
      store.clear()

      const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: stale },
        body: JSON.stringify({ username: 'oleg', password: 'a-real-password' })
      })

      expect(response.status).toBe(200)
    })
  })
})
