import type { AdminPaginatedRes, AdminSafeBoxListItem } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminTradersService } from 'src/modules/admin/services'

@Controller('admin/safe-box')
export class AdminSafeBoxController {
  constructor(private readonly tradersService: AdminTradersService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminSafeBoxListItem>> {
    return this.tradersService.listSafeBox(query)
  }
}
