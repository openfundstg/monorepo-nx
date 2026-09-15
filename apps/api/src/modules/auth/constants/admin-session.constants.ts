/** Everything tunable about an admin session, in one place. */
export const ADMIN_SESSION = {
  /** Cookie carrying the opaque session id. */
  COOKIE_NAME: 'admin_session',
  /**
   * Scope of the CSRF cookie.
   *
   * Narrower than the session cookie on purpose — see `attachCookies`. The Mini
   * App shares this origin, and `CsrfGuard` enforces wherever the cookie is
   * sent, so widening this path breaks every Mini App write.
   */
  CSRF_COOKIE_PATH: '/api/admin',
  /** 256 bits of session id. */
  ID_BYTES: 32,
  CSRF_BYTES: 32,
  /** Twelve hours — one working day, after which an unattended panel is shut. */
  TTL_SECONDS: 12 * 60 * 60,
  MAX_LOGIN_ATTEMPTS: 5,
  /** How long a lockout lasts, measured from the most recent failure. */
  LOGIN_WINDOW_SECONDS: 15 * 60
} as const
