import {
  AdminAuditAction,
  AdminAuditTargetType,
  ERROR,
  type AdminLoginReq,
  type AdminSessionRes
} from '@transacto/contracts'
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { AdminSessionService } from 'src/modules/auth'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'

/**
 * Logging in, out, and answering "who am I".
 *
 * Named apart from `AdminAuthService` in `src/modules/auth`, which is the
 * `UserTypeAuthenticator` the global guard runs on every request. That one
 * resolves an existing session; this one creates and destroys them, and is the
 * only place the audit trail's `LOGIN` rows come from.
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name)

  constructor(
    private readonly sessionService: AdminSessionService,
    private readonly auditService: AdminAuditService
  ) {}

  /**
   * Verifies credentials, opens a session and writes both cookies.
   *
   * The lockout check comes first and the counter is cleared only on success,
   * so a run of failures from one address costs the attacker the window even if
   * they eventually guess right within it.
   */
  async login(request: AdminLoginReq, ip: string, response: Response): Promise<AdminSessionRes> {
    await this.sessionService.assertNotLockedOut(ip)

    if (!this.sessionService.verifyCredentials(request.username, request.password)) {
      await this.sessionService.recordFailedAttempt(ip)
      this.logger.warn(`Failed admin login for "${request.username}" from ${ip}`)

      // Recorded under the *submitted* username, which is the only useful thing
      // about a failure — it distinguishes a typo by the operator from somebody
      // guessing names. Never the password, not even its length.
      await this.auditService.record({
        actor: request.username,
        action: AdminAuditAction.LOGIN_FAILED,
        targetType: AdminAuditTargetType.SESSION,
        targetId: ip,
        ip
      })

      throw new UnauthorizedException(ERROR.ADMIN.INVALID_CREDENTIALS)
    }

    await this.sessionService.clearAttempts(ip)

    const { sessionId, csrfToken, expiresAt } = await this.sessionService.create(request.username)
    this.sessionService.attachCookies(response, sessionId, csrfToken)

    await this.auditService.record({
      actor: request.username,
      action: AdminAuditAction.LOGIN,
      targetType: AdminAuditTargetType.SESSION,
      targetId: sessionId.slice(0, 8),
      ip
    })

    this.logger.log(`Admin "${request.username}" signed in from ${ip}`)

    return { username: request.username, csrfToken, expiresAt: expiresAt.toISOString() }
  }

  async logout(admin: AdminPrincipal, ip: string, response: Response): Promise<void> {
    await this.sessionService.revoke(admin.sessionId)
    this.sessionService.clearCookies(response)

    await this.auditService.record({
      actor: admin.username,
      action: AdminAuditAction.LOGOUT,
      targetType: AdminAuditTargetType.SESSION,
      targetId: admin.sessionId.slice(0, 8),
      ip
    })
  }

  /**
   * The current session, for a page that has just loaded.
   *
   * Re-issues the CSRF token in the body rather than expecting the page to read
   * its own cookie: the cookie is scoped to `/api/admin`, so a page served from
   * `/admin` cannot see it at all. The token itself is unchanged — this is the
   * same value the login stored, read back out of the session.
   */
  async me(admin: AdminPrincipal): Promise<AdminSessionRes> {
    const [session, expiresAt] = await Promise.all([
      this.sessionService.resolve(admin.sessionId),
      this.sessionService.expiresAt(admin.sessionId)
    ])

    // The guard resolved this session moments ago, so a miss here means it was
    // revoked in between — which is a 401, not a 500.
    if (!session) throw new UnauthorizedException(ERROR.ADMIN.NO_SESSION)

    return {
      username: session.username,
      csrfToken: session.csrfToken,
      expiresAt: expiresAt.toISOString()
    }
  }
}
