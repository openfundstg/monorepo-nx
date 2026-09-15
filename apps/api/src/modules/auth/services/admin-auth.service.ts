import { ERROR } from '@transacto/contracts'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { ensure } from 'src/shared/utils'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { ADMIN_SESSION } from 'src/modules/auth/constants/admin-session.constants'
import { AdminSessionService } from 'src/modules/auth/services/admin-session.service'
import type { UserTypeAuthenticator } from 'src/modules/auth/interfaces/user-type-authenticator.interface'

/**
 * `UserType.ADMIN` — resolves the `admin_session` cookie to the operator behind
 * it and attaches them to the request.
 *
 * The only scheme here that authenticates with something the browser sends by
 * itself, which is why every admin route is also covered by `CsrfGuard`: the
 * login response sets a `csrf-token` cookie scoped to `/api/admin`, and that
 * cookie's presence is what switches the guard from inert to enforcing.
 */
@Injectable()
export class AdminAuthService implements UserTypeAuthenticator {
  constructor(private readonly sessionService: AdminSessionService) {}

  async authenticate(request: Request): Promise<void> {
    const sessionId = ensure(
      this.sessionService.readCookie(request, ADMIN_SESSION.COOKIE_NAME),
      new UnauthorizedException(ERROR.ADMIN.NO_SESSION)
    )

    const principal = ensure(
      await this.sessionService.resolve(sessionId),
      new UnauthorizedException(ERROR.ADMIN.NO_SESSION)
    )

    ;(request as AdminAuthenticatedRequest).admin = {
      username: principal.username,
      sessionId: principal.sessionId
    }
  }
}
