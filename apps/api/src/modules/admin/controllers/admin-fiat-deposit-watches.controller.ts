import type { AdminFiatDepositWatchListItem, AdminPaginatedRes } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminFiatDepositWatchesService } from 'src/modules/admin/services'

/** No `action` endpoint, deliberately — see the service for why. */
@Controller('admin/fiat-deposit-watches')
export class AdminFiatDepositWatchesController {
  constructor(private readonly watchesService: AdminFiatDepositWatchesService) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminFiatDepositWatchListItem>> {
    return this.watchesService.list(query)
  }
}
