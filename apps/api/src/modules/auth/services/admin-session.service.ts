import { ERROR } from '@transacto/contracts'
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { randomBytes, timingSafeEqual, createHash } from 'crypto'
import type { Redis } from 'ioredis'
import type { Request, Response } from 'express'
import environments from 'src/environments'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { ADMIN_SESSION } from 'src/modules/auth/constants/admin-session.constants'
import { CSRF_COOKIE_NAME } from 'src/modules/auth/guards/csrf.guard'

/**
 * Issues, resolves and revokes admin sessions.
 *
 * Lives in `auth` rather than in the admin module because `AdminAuthService`
 * needs it on every request and the admin module needs `auth` for its
 * decorators — putting it the other way round makes the two modules import each
 * other. Authentication state belongs here anyway.
 *
 * A session is an opaque 256-bit id in Redis, not a signed cookie carrying
 * claims. The difference that matters is revocation: a signed cookie is valid
 * until it expires no matter what the server thinks, and there is no way to end
 * it early.
 */
@Injectable()
export class AdminSessionService {
  private readonly logger = new Logger(AdminSessionService.name)

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Checks the submitted credentials against the configured ones.
   *
   * Both halves are compared with `timingSafeEqual` over a SHA-256 digest
   * rather than directly: `timingSafeEqual` throws on a length mismatch, which
   * on its own would leak the password's length, and hashing first makes every
   * comparison the same 32 bytes.
   */
  verifyCredentials(username: string, password: string): boolean {
    const expectedUser = environments.ADMIN_USERNAME
    const expectedPassword = environments.ADMIN_PASSWORD

    // No credentials configured means the panel is shut, never open. Answering
    // "granted" here would publish every endpoint behind it to the internet.
    if (!expectedUser || !expectedPassword) {
      this.logger.error('ADMIN_USERNAME / ADMIN_PASSWORD are not configured — refusing every login')
      throw new UnauthorizedException(ERROR.ADMIN.NOT_CONFIGURED)
    }

    // Both halves are always compared, even when the first already failed, so
    // the response time does not say which one was wrong.
    const userMatches = this.constantTimeEquals(username, expectedUser)
    const passwordMatches = this.constantTimeEquals(password, expectedPassword)

    return userMatches && passwordMatches
  }

  /** Creates a session and returns the cookie value plus its CSRF token. */
  async create(
    username: string
  ): Promise<{ sessionId: string; csrfToken: string; expiresAt: Date }> {
    const sessionId = randomBytes(ADMIN_SESSION.ID_BYTES).toString('hex')
    const csrfToken = randomBytes(ADMIN_SESSION.CSRF_BYTES).toString('hex')

    await this.redis.set(
      RedisKeys.Admin.session(sessionId),
      JSON.stringify({ username, csrfToken }),
      'EX',
      ADMIN_SESSION.TTL_SECONDS
    )

    return {
      sessionId,
      csrfToken,
      expiresAt: new Date(Date.now() + ADMIN_SESSION.TTL_SECONDS * 1000)
    }
  }

  /** The principal behind a session id, or `null` when it has expired or been revoked. */
  async resolve(sessionId: string): Promise<(AdminPrincipal & { csrfToken: string }) | null> {
    const raw = await this.redis.get(RedisKeys.Admin.session(sessionId))
    if (!raw) return null

    try {
      const stored = JSON.parse(raw) as { username: string; csrfToken: string }
      return { username: stored.username, sessionId, csrfToken: stored.csrfToken }
    } catch {
      // A value we wrote ourselves failed to parse — treat it as no session
      // rather than a 500, and clear it so it stops happening.
      await this.redis.del(RedisKeys.Admin.session(sessionId))
      return null
    }
  }

  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(RedisKeys.Admin.session(sessionId))
  }

  /** Remaining TTL of a session as an absolute time, for `GET /auth/me`. */
  async expiresAt(sessionId: string): Promise<Date> {
    const ttl = await this.redis.ttl(RedisKeys.Admin.session(sessionId))
    const seconds = ttl > 0 ? ttl : 0
    return new Date(Date.now() + seconds * 1000)
  }

  // --- Brute-force limiting -------------------------------------------------

  /** Throws once an address has burned through its attempts inside the window. */
  async assertNotLockedOut(ip: string): Promise<void> {
    const attempts = await this.redis.get(RedisKeys.Admin.loginAttempts(ip))
    if (attempts && Number(attempts) >= ADMIN_SESSION.MAX_LOGIN_ATTEMPTS)
      throw new UnauthorizedException(ERROR.ADMIN.TOO_MANY_ATTEMPTS)
  }

  /**
   * Records a failure and (re)starts the window.
   *
   * The TTL is refreshed on every failure on purpose: the window measures time
   * since the last attempt, so an attacker cannot pace themselves to keep a
   * counter alive while it silently expires underneath them.
   */
  async recordFailedAttempt(ip: string): Promise<void> {
    const key = RedisKeys.Admin.loginAttempts(ip)
    await this.redis.incr(key)
    await this.redis.expire(key, ADMIN_SESSION.LOGIN_WINDOW_SECONDS)
  }

  async clearAttempts(ip: string): Promise<void> {
    await this.redis.del(RedisKeys.Admin.loginAttempts(ip))
  }

  // --- Cookies --------------------------------------------------------------

  /**
   * Writes both cookies.
   *
   * The session cookie is `HttpOnly` so script cannot read it, and scoped to
   * `/` because the Socket.IO handshake at `/socket.io` has to carry it — there
   * is no other way to authenticate a WebSocket the browser opens itself.
   *
   * The CSRF cookie is deliberately *not* `HttpOnly` — the page has to read it
   * to echo it back — and is scoped to `/api/admin`. That scope is load-bearing
   * rather than tidiness: `CsrfGuard` enforces on any request carrying a
   * `csrf-token` cookie, and the Mini App is served from this same origin, so a
   * cookie at `/` would start failing every Mini App POST the moment an
   * operator logged in.
   */
  attachCookies(response: Response, sessionId: string, csrfToken: string): void {
    const secure = this.isSecure()
    response.cookie(ADMIN_SESSION.COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ADMIN_SESSION.TTL_SECONDS * 1000
    })
    response.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: ADMIN_SESSION.CSRF_COOKIE_PATH,
      maxAge: ADMIN_SESSION.TTL_SECONDS * 1000
    })
  }

  /** Clears both cookies with the exact attributes they were set with. */
  clearCookies(response: Response): void {
    const secure = this.isSecure()
    response.clearCookie(ADMIN_SESSION.COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/'
    })
    response.clearCookie(CSRF_COOKIE_NAME, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: ADMIN_SESSION.CSRF_COOKIE_PATH
    })
  }

  /** Reads one cookie off a raw request — used by the HTTP guard and the gateway alike. */
  readCookie(request: Pick<Request, 'headers'>, name: string): string | null {
    const header = request.headers.cookie
    if (!header) return null

    const match = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))

    return match ? decodeURIComponent(match.slice(name.length + 1)) : null
  }

  /**
   * `Secure` is off outside production only.
   *
   * A `Secure` cookie is dropped by the browser over plain HTTP, which is what
   * `nx serve` speaks — so hardcoding it on would make local development
   * impossible, and hardcoding it off would ship a session cookie that travels
   * in the clear.
   */
  private isSecure(): boolean {
    return environments.NODE_ENV !== 'development' && environments.NODE_ENV !== 'LOCAL'
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const left = createHash('sha256').update(a).digest()
    const right = createHash('sha256').update(b).digest()
    return timingSafeEqual(left, right)
  }
}
