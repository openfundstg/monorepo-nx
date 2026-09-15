import {
  AdminWsEventNames,
  type AdminAuditAction,
  type AdminAuditLogItem,
  type AdminAuditTargetType,
  type AdminPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Injectable, Logger } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { AdminAuditLogDbService, type AdminAuditLog } from 'src/modules/repositories/admin-db'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { clampLimit } from 'src/modules/admin/dto'
import {
  escapeRegex,
  toAdminAuditEntry,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/**
 * Writes and reads the admin audit trail.
 *
 * Every state-changing admin service calls {@link record} — that is the whole
 * contract. Two things follow from doing it here rather than at each call site:
 * the trail cannot be half-implemented, and the push to other operators' open
 * tabs happens automatically, so a second admin sees an action land without
 * anyone remembering to emit for it.
 *
 * **Recording never throws.** An audit write that fails must not roll back the
 * thing it was recording — the money has already moved, and turning a
 * successful correction into a 500 would invite the operator to do it again.
 * A failure is logged loudly instead.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name)

  constructor(
    private readonly auditDbService: AdminAuditLogDbService,
    private readonly gateway: AdminGateway
  ) {}

  async record(entry: {
    actor: string
    action: AdminAuditAction
    targetType: AdminAuditTargetType
    targetId: string
    reason?: string | null
    metadata?: Record<string, unknown> | null
    ip?: string | null
  }): Promise<void> {
    try {
      const stored = await this.auditDbService.append({
        actor: entry.actor,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null
      })

      this.gateway.emit(AdminWsEventNames.AUDIT_LOGGED, { entry: toAdminAuditEntry(stored) })
    } catch (error: unknown) {
      this.logger.error(
        `Failed to record audit entry ${entry.action} on ${entry.targetType}:${entry.targetId} ` +
          `by ${entry.actor}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminAuditLogItem>> {
    const limit = clampLimit(request.limit)
    const filter: QueryFilter<AdminAuditLog> = {}

    if (request.search) {
      const pattern = new RegExp(escapeRegex(request.search), 'i')
      filter.$or = [{ actor: pattern }, { targetId: pattern }, { reason: pattern }]
    }

    const page = await this.auditDbService.findPage(
      filter,
      toPageQuery({ ...request, limit }, ADMIN_SORTABLE.AUDIT)
    )

    return toPaginatedRes(page, { ...request, limit }, toAdminAuditEntry)
  }
}
