import { ERROR } from '@transacto/contracts'
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { timingSafeEqual } from 'crypto'
import type { Request } from 'express'
import { AUTH_METADATA } from 'src/modules/auth/constants/auth-metadata.constants'

/** Name of the double-submit cookie and the header that must echo it. */
export const CSRF_COOKIE_NAME = 'csrf-token'
export const CSRF_HEADER_NAME = 'x-csrf-token'

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Double-submit CSRF check on state-changing requests.
 *
 * **This is inert today, by design.** CSRF only bites when the browser attaches
 * credentials *ambiently* — cookies. Every caller here authenticates with an
 * explicit header (`x-api-token`, `x-tma-init-data`) that a cross-site attacker
 * cannot make the victim's browser send, so there is nothing to forge. The
 * guard therefore enforces only when a `csrf-token` cookie is actually present,
 * which is never at the moment.
 *
 * It exists so that the day cookie/session auth is introduced, the protection
 * and the `@SkipCsrf()` exemptions are already in place rather than being
 * retrofitted onto live endpoints.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true

    const exempt = this.reflector.getAllAndOverride<boolean>(AUTH_METADATA.SKIP_CSRF, [
      context.getHandler(),
      context.getClass()
    ])
    if (exempt) return true

    const request = context.switchToHttp().getRequest<Request>()
    if (SAFE_METHODS.has(request.method)) return true

    const cookieToken = this.readCookie(request, CSRF_COOKIE_NAME)
    // No CSRF cookie means the request carries no ambient credentials, so there
    // is no cross-site request to forge.
    if (!cookieToken) return true

    const headerToken = request.headers[CSRF_HEADER_NAME] as string | undefined
    if (!headerToken || !this.equals(headerToken, cookieToken))
      throw new ForbiddenException(ERROR.AUTH.CSRF_TOKEN_MISMATCH)

    return true
  }

  private readCookie(request: Request, name: string): string | null {
    const header = request.headers.cookie
    if (!header) return null

    const match = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))

    return match ? decodeURIComponent(match.slice(name.length + 1)) : null
  }

  private equals(a: string, b: string): boolean {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
  }
}
