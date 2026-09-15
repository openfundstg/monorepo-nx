import type { AdminAuditLogItem, AdminPaginatedRes } from '@transacto/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminAuditService } from 'src/modules/admin/services'

/**
 * The audit trail. Read-only, and there is no write endpoint by design — rows
 * are appended by the services that cause them, never by a caller.
 */
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get()
  @UserTypeAdmin()
  async list(@Query() query: AdminPageQueryDto): Promise<AdminPaginatedRes<AdminAuditLogItem>> {
    return this.auditService.list(query)
  }
}
