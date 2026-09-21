import type {
  AdminPaginatedRes,
  AdminSaleDetailRes,
  AdminSaleListItem
} from '@transacto/contracts'
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminSaleActionReqDto, AdminSalesPageQueryDto } from 'src/modules/admin/dto'
import { AdminSalesService } from 'src/modules/admin/services'

@Controller('admin/sales')
export class AdminSalesController {
  constructor(private readonly salesService: AdminSalesService) {}

  /**
   * The whole sales book, sliced by a chip.
   *
   * **Including the dispute queue**, which used to be a route of its own. The
   * search box takes a Transacto order number as readily as a sale's public
   * code, because an operator arriving from their panel holds the first and a
   * seller quoting support gives the second — and a screen that answers only
   * one of those is a screen somebody has to remember not to use.
   */
  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminSalesPageQueryDto
  ): Promise<AdminPaginatedRes<AdminSaleListItem>> {
    return this.salesService.list(query)
  }

  /**
   * One sale, with the seller, the terminal, the orders and the documents.
   *
   * Declared before `:id/action` matters not at all — they are different
   * methods — but it is placed here to read in the order an operator uses them.
   */
  @Get(':id')
  @UserTypeAdmin()
  async detail(@Param('id') id: string): Promise<AdminSaleDetailRes> {
    return this.salesService.detail(id)
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
