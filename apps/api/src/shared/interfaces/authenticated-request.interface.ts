import { Request } from 'express'
import { Trader } from 'src/modules/repositories/trader-db/schemas'

/** Request that passed `@UserTypeTrader()` — `trader` is guaranteed present. */
export interface AuthenticatedRequest extends Request {
  trader: Trader
}

/** Telegram user, as carried inside a verified `initData` payload. */
export interface TmaAuthUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

/** Request that passed `@UserTypeTMA()` — `tmaUser` is guaranteed present. */
export interface TmaAuthenticatedRequest extends Request {
  tmaUser: TmaAuthUser
  /**
   * The `startapp` payload of the deep link that opened the Mini App, when
   * there was one.
   *
   * Read off the verified `initData` rather than a query string, so it carries
   * Telegram's signature: a client cannot claim to have arrived through a link
   * it did not open. That is what lets the referral binding trust it without
   * further checks.
   */
  tmaStartParam?: string
}

/** The principal behind an `admin_session` cookie. */
export interface AdminPrincipal {
  /** The configured `ADMIN_USERNAME`. There is exactly one admin identity today. */
  username: string
  /** Opaque session id — the cookie's value, and the Redis key it resolves through. */
  sessionId: string
}

/** Request that passed `@UserTypeAdmin()` — `admin` is guaranteed present. */
export interface AdminAuthenticatedRequest extends Request {
  admin: AdminPrincipal
}
