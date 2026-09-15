import type { AdminPaginatedRes, AdminSaleListItem } from '@transacto/contracts'
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminPageQueryDto, AdminSaleActionReqDto } from 'src/modules/admin/dto'
import { AdminSalesService } from 'src/modules/admin/services'

@Controller('admin/sales')
export class AdminSalesController {
  constructor(private readonly salesService: AdminSalesService) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminSaleListItem>> {
    return this.salesService.list(query)
  }

  /**
   * One endpoint for all three interventions.
   *
   * They share their preconditions and their audit shape, and an operator picks
   * between them in one dialog — three endpoints would be three routes with the
   * same guard, the same lookup and the same 409.
   */
  @Post(':id/action')
  @UserTypeAdmin()
  async act(
    @Param('id') id: string,
    @Body() body: AdminSaleActionReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminSaleListItem> {
    return this.salesService.act(
      id,
      body,
      request.admin,
      request.ip ?? request.socket.remoteAddress ?? 'unknown'
    )
  }
}
