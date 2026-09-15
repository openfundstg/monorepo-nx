import type {
  AdminPaginatedRes,
  AdminTerminalHistoryItem,
  AdminTerminalListItem
} from '@transacto/contracts'
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminPageQueryDto, AdminSetTerminalStateReqDto } from 'src/modules/admin/dto'
import { AdminTerminalsService } from 'src/modules/admin/services'

@Controller('admin/terminals')
export class AdminTerminalsController {
  constructor(private readonly terminalsService: AdminTerminalsService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminTerminalListItem>> {
    return this.terminalsService.list(query)
  }

  /**
   * Keyed by `cardId`, not `terminalId`.
   *
   * `cardId` is the identifier every terminal has — `terminalId` is `null` on
   * one that never reached Transacto — and it is what the scraper files history
   * under.
   */
  @Get(':cardId/history')
  @UserTypeAdmin()
  async history(
    @Param('cardId', ParseIntPipe) cardId: number,
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminTerminalHistoryItem>> {
    return this.terminalsService.history(cardId, query)
  }

  @Post(':cardId/state')
  @UserTypeAdmin()
  async setState(
    @Param('cardId', ParseIntPipe) cardId: number,
    @Body() body: AdminSetTerminalStateReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminTerminalListItem> {
    return this.terminalsService.setState(
      cardId,
      body,
      request.admin,
      request.ip ?? request.socket.remoteAddress ?? 'unknown'
    )
  }
}
