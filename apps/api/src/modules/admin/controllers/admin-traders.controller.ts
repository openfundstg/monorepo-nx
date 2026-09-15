import type { AdminPaginatedRes, AdminTraderListItem } from '@transacto/contracts'
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminPageQueryDto, AdminSetTraderActiveReqDto } from 'src/modules/admin/dto'
import { AdminTradersService } from 'src/modules/admin/services'

@Controller('admin/traders')
export class AdminTradersController {
  constructor(private readonly tradersService: AdminTradersService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminTraderListItem>> {
    return this.tradersService.list(query)
  }

  @Post(':traderId/active')
  @UserTypeAdmin()
  async setActive(
    @Param('traderId', ParseIntPipe) traderId: number,
    @Body() body: AdminSetTraderActiveReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminTraderListItem> {
    return this.tradersService.setActive(
      traderId,
      body,
      request.admin,
      request.ip ?? request.socket.remoteAddress ?? 'unknown'
    )
  }
}
