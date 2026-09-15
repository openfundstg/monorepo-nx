import type { Request } from 'express'

/**
 * One authentication scheme, i.e. one {@link UserType}.
 *
 * Verifies the request's credentials and attaches the resolved principal to
 * the request object. Throws an `UnauthorizedException` when the credentials
 * are missing or invalid — never returns `false`, so the caller always gets a
 * specific `ERROR` code instead of a bare 401.
 */
export interface UserTypeAuthenticator {
  authenticate(request: Request): Promise<void>
}
