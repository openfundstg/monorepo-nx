import type { AdminOrderListItem, AdminPaginatedRes } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminTerminalsService } from 'src/modules/admin/services'

/**
 * Transacto orders. Served by `AdminTerminalsService`, because an order only
 * exists in relation to the terminal it was routed to and the two are read
 * together on every screen that shows either.
 */
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly terminalsService: AdminTerminalsService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminOrderListItem>> {
    return this.terminalsService.listOrders(query)
  }
}
