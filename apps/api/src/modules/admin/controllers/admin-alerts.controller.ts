import type { AdminAlertListItem, AdminPaginatedRes } from '@transacto/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req
} from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminAlertActionReqDto, AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminAlertsService } from 'src/modules/admin/services'

/**
 * Alerts across every trader.
 *
 * Acknowledging and force-matching stay in the extension: those are a trader's
 * decisions about their own money, and the flows behind them settle it.
 * Resolving and deleting are the operator's — the first says an alert has been
 * dealt with outside the system, the second removes one that should never have
 * been raised.
 */
@Controller('admin/alerts')
export class AdminAlertsController {
  constructor(private readonly alertsService: AdminAlertsService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminAlertListItem>> {
    return this.alertsService.list(query)
  }

  @Post(':id/resolve')
  @UserTypeAdmin()
  async resolve(
    @Param('id') id: string,
    @Body() body: AdminAlertActionReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminAlertListItem> {
    return this.alertsService.resolve(id, body, request.admin, this.ip(request))
  }

  /**
   * `DELETE` with a body, deliberately.
   *
   * The reason is not optional — it is the only thing that survives the row —
   * and Express and every client here send and read a `DELETE` body without
   * complaint. The alternative, a reason in the query string, would put an
   * operator's free text in every access log.
   */
  @Delete(':id')
  @UserTypeAdmin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Body() body: AdminAlertActionReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<void> {
    return this.alertsService.delete(id, body, request.admin, this.ip(request))
  }

  private ip(request: AdminAuthenticatedRequest): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown'
  }
}
