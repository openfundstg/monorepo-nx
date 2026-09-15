import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common'
import type { ReferralBalancesRes, ReferralSummary } from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { ReferralService } from 'src/modules/telegram-mini-app/services/referral.service'
import { RedeemReferralCodeReqDto } from 'src/modules/telegram-mini-app/dto/redeem-referral-code.req.dto'
import { TransferReferralReqDto } from 'src/modules/telegram-mini-app/dto/transfer-referral.req.dto'
import { ReferralNameVisibilityReqDto } from 'src/modules/telegram-mini-app/dto/referral-name-visibility.req.dto'

@Controller('tma/referral')
export class TmaReferralController {
  constructor(private readonly referralService: ReferralService) {}

  /**
   * GET /tma/referral
   * The caller's code, share link, both balance figures and their referrals.
   */
  @Get()
  @UserTypeTMA()
  async getSummary(@Req() req: TmaAuthenticatedRequest): Promise<ReferralSummary> {
    return this.referralService.getSummary(req.tmaUser.id)
  }

  /**
   * POST /tma/referral/redeem
   * Binds the caller to a friend's code, for users who installed the app
   * before being invited. Returns the refreshed summary so the page repaints
   * from one response.
   */
  @Post('redeem')
  @UserTypeTMA()
  async redeem(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: RedeemReferralCodeReqDto
  ): Promise<ReferralSummary> {
    return this.referralService.redeemCode(req.tmaUser.id, dto.code)
  }

  /**
   * POST /tma/referral/transfer
   * Moves referral earnings onto the spendable balance — the only thing that
   * can be done with them.
   */
  @Post('transfer')
  @UserTypeTMA()
  async transfer(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: TransferReferralReqDto
  ): Promise<ReferralBalancesRes> {
    return this.referralService.transferToBalance(req.tmaUser.id, dto.amount)
  }

  /**
   * PATCH /tma/referral/name-visibility
   * The caller's own choice about whether their referrer sees their name.
   * Rendered on the settings screen, but it is a referral concern, so it lives
   * with the rest of the programme.
   */
  @Patch('name-visibility')
  @UserTypeTMA()
  async setNameVisibility(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: ReferralNameVisibilityReqDto
  ): Promise<void> {
    await this.referralService.setNameVisibility(req.tmaUser.id, dto.showNameToReferrer)
  }
}
