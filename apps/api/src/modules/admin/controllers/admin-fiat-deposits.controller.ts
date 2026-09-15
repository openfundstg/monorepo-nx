import type { AdminFiatDepositListItem, AdminPaginatedRes } from '@transacto/contracts'
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminFiatDepositActionReqDto, AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminFiatDepositsService } from 'src/modules/admin/services'

@Controller('admin/fiat-deposits')
export class AdminFiatDepositsController {
  constructor(private readonly fiatDepositsService: AdminFiatDepositsService) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminFiatDepositListItem>> {
    return this.fiatDepositsService.list(query)
  }

  /**
   * One endpoint for both interventions.
   *
   * They share their lookup, their audit shape and their 409, and an operator
   * picks between them in one dialog — two routes would be two copies of all of
   * it.
   */
  @Post(':id/action')
  @UserTypeAdmin()
  async act(
    @Param('id') id: string,
    @Body() body: AdminFiatDepositActionReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminFiatDepositListItem> {
    return this.fiatDepositsService.act(
      id,
      body,
      request.admin,
      request.ip ?? request.socket.remoteAddress ?? 'unknown'
    )
  }
}
