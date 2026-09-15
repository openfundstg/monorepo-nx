import type { AdminSessionRes } from '@transacto/contracts'
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public, SkipCsrf, UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminLoginReqDto } from 'src/modules/admin/dto'
import { AdminLoginService } from 'src/modules/admin/services'

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly loginService: AdminLoginService) {}

  /**
   * `@SkipCsrf()` on a state-changing endpoint, deliberately.
   *
   * The CSRF cookie is scoped to `/api/admin`, so a browser that still holds
   * one from an expired session sends it here — and `CsrfGuard` would then
   * demand a header the login page cannot produce, locking the operator out of
   * the very form that would fix it. Login CSRF itself is not a threat worth
   * the trade: there is one account, so an attacker who could forge this
   * request would need the password, at which point they can simply log in.
   *
   * `passthrough: true` because the handler writes cookies onto the response
   * and still returns a body for Nest to serialise.
   */
  @Post('login')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: AdminLoginReqDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AdminSessionRes> {
    return this.loginService.login(body, this.ip(request), response)
  }

  @Post('logout')
  @UserTypeAdmin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AdminAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    return this.loginService.logout(request.admin, this.ip(request), response)
  }

  /** Who the cookie belongs to, and the CSRF token to echo on writes. */
  @Get('me')
  @UserTypeAdmin()
  async me(@Req() request: AdminAuthenticatedRequest): Promise<AdminSessionRes> {
    return this.loginService.me(request.admin)
  }

  /**
   * The caller's address, as Express reports it.
   *
   * Behind the production reverse proxy this is the proxy — `trust proxy` is
   * not enabled — so it is a hint on an audit row, and the rate limiter it
   * keys on bounds the whole panel rather than one client. Both are stated
   * where they are used; neither is treated as evidence.
   */
  private ip(request: Request): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown'
  }
}
