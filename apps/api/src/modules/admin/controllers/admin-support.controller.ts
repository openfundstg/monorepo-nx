import type {
  AdminPaginatedRes,
  AdminSupportTopicListItem,
  AdminSupportUserListItem
} from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminSupportService } from 'src/modules/admin/services'

@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly supportService: AdminSupportService) {}

  @Get('topics')
  @UserTypeAdmin()
  async topics(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminSupportTopicListItem>> {
    return this.supportService.listTopics(query)
  }

  @Get('users')
  @UserTypeAdmin()
  async users(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminSupportUserListItem>> {
    return this.supportService.listUsers(query)
  }
}
