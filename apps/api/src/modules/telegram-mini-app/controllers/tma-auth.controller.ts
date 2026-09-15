import { Controller, Post, Req } from '@nestjs/common'
import type { AuthResponse } from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { ReferralService } from 'src/modules/telegram-mini-app/services/referral.service'
import { getTrustLevel } from 'src/shared/constants'

@Controller('tma/auth')
export class TmaAuthController {
  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly referralService: ReferralService
  ) {}

  /**
   * POST /api/tma/auth
   * Validates Telegram initData, upserts user, returns profile + trust level.
   */
  @Post()
  @UserTypeTMA()
  async authenticate(@Req() req: TmaAuthenticatedRequest): Promise<AuthResponse> {
    const tgUser = req.tmaUser

    const { user, isNewUser } = await this.userDbService.findOrCreate(tgUser.id, {
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      username: tgUser.username
    })

    // Attribution happens here and only for a first-time user: the deep link is
    // how somebody arrives, so binding on any later open would let an
    // established account be moved under a referrer after its volume is known.
    // `bindFromStartParam` swallows its own failures — a stale or bogus code
    // must not stop a login.
    if (isNewUser && req.tmaStartParam)
      await this.referralService.bindFromStartParam(tgUser.id, req.tmaStartParam)

    const trustLevel = getTrustLevel(user.totalTurnover)

    return {
      user: {
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        balance: user.balance,
        // Part of the shared TmaUser contract; omitting it left the dashboard's
        // frozen figure permanently at zero.
        frozenBalance: user.frozenBalance,
        totalTurnover: user.totalTurnover,
        isActive: user.isActive,
        referralBalance: user.referralBalance,
        totalReferralEarned: user.totalReferralEarned,
        showNameToReferrer: user.showNameToReferrer
      },
      trustLevel,
      isNewUser
    }
  }
}
