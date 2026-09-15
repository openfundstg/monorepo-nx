import type { AdminDepositListItem, AdminPaginatedRes } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminDepositsService } from 'src/modules/admin/services'

@Controller('admin/deposits')
export class AdminDepositsController {
  constructor(private readonly depositsService: AdminDepositsService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminDepositListItem>> {
    return this.depositsService.list(query)
  }
}
