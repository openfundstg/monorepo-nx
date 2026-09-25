import type {
  AdminAdjustBalanceRes,
  AdminPaginatedRes,
  AdminTmaUserDetailRes,
  AdminTmaUserListItem
} from '@transacto/contracts'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req
} from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import {
  AdminAdjustBalanceReqDto,
  AdminPageQueryDto,
  AdminSetUserActiveReqDto,
  AdminSetUserDemoReqDto
} from 'src/modules/admin/dto'
import { AdminUsersService } from 'src/modules/admin/services'

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminTmaUserListItem>> {
    return this.usersService.list(query)
  }

  @Get(':telegramId')
  @UserTypeAdmin()
  async detail(
    @Param('telegramId', ParseIntPipe) telegramId: number
  ): Promise<AdminTmaUserDetailRes> {
    return this.usersService.detail(telegramId)
  }

  @Post(':telegramId/active')
  @UserTypeAdmin()
  async setActive(
    @Param('telegramId', ParseIntPipe) telegramId: number,
    @Body() body: AdminSetUserActiveReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminTmaUserListItem> {
    return this.usersService.setActive(telegramId, body, request.admin, this.ip(request))
  }

  /**
   * Makes a promoter's account a demo account, or an ordinary one again.
   *
   * `200` rather than the `201` a `POST` defaults to: nothing is created, a
   * flag on an existing account changes.
   */
  @Post(':telegramId/demo')
  @HttpCode(HttpStatus.OK)
  @UserTypeAdmin()
  async setDemo(
    @Param('telegramId', ParseIntPipe) telegramId: number,
    @Body() body: AdminSetUserDemoReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminTmaUserListItem> {
    return this.usersService.setDemo(telegramId, body, request.admin, this.ip(request))
  }

  @Post(':telegramId/balance')
  @UserTypeAdmin()
  async adjustBalance(
    @Param('telegramId', ParseIntPipe) telegramId: number,
    @Body() body: AdminAdjustBalanceReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminAdjustBalanceRes> {
    return this.usersService.adjustBalance(telegramId, body, request.admin, this.ip(request))
  }

  private ip(request: AdminAuthenticatedRequest): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown'
  }
}
