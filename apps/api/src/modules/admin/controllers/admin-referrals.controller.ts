import type { AdminPaginatedRes, AdminReferralEarningListItem } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminUsersService } from 'src/modules/admin/services'

/**
 * Its own route, served by `AdminUsersService`.
 *
 * A referral payout is a user's money seen from the other side, and it is read
 * through the same name resolution the user lists need — so a separate service
 * would duplicate that lookup rather than isolate anything.
 */
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminReferralEarningListItem>> {
    return this.usersService.listReferralEarnings(query)
  }
}
