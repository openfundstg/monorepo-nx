import { Controller, Post, Req } from '@nestjs/common'
import type { AuthResponse } from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { TmaSessionService } from 'src/modules/telegram-mini-app/services/tma-session.service'
import { DemoAllowed } from 'src/modules/telegram-mini-app/decorators/demo-allowed.decorator'

@Controller('tma/auth')
export class TmaAuthController {
  constructor(private readonly sessionService: TmaSessionService) {}

  /**
   * POST /api/tma/auth
   * Validates Telegram initData, upserts user, returns profile + trust level.
   *
   * A write by method only — the one every launch makes — so a demo account
   * must be let through it, or it could never open the app at all.
   */
  @Post()
  @UserTypeTMA()
  @DemoAllowed()
  async authenticate(@Req() req: TmaAuthenticatedRequest): Promise<AuthResponse> {
    return this.sessionService.open(req.tmaUser, req.tmaStartParam)
  }
}
