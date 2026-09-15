import type { AdminOverviewRes } from '@transacto/contracts'
import { Controller, Get } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminOverviewService } from 'src/modules/admin/services'

@Controller('admin/overview')
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get()
  @UserTypeAdmin()
  async overview(): Promise<AdminOverviewRes> {
    return this.overviewService.build()
  }
}
