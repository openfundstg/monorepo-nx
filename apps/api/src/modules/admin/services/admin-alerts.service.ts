import {
  AdminAuditAction,
  AdminAuditTargetType,
  AlertStatus,
  ERROR,
  type AdminAlertActionReq,
  type AdminAlertListItem,
  type AdminPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { QueryFilter, Types } from 'mongoose'
import { AlertDbService } from 'src/modules/repositories/alerts-db/services'
import type { Alert } from 'src/modules/repositories/alerts-db/schemas'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { ensure } from 'src/shared/utils'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { toAdminAlert, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

/** A lean alert plus its id — what every read here returns. */
type StoredAlert = Alert & { _id: Types.ObjectId }

/**
 * Alerts, across every trader, with the two things an operator can do to one.
 *
 * Split out of `AdminTradersService` when it gained writes. Reading alerts
 * alongside traders was one concern; resolving and deleting them is another,
 * and the second one destroys records.
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name)

  constructor(
    private readonly alertDbService: AlertDbService,
    private readonly alertsService: AlertsService,
    private readonly auditService: AdminAuditService
  ) {}

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminAlertListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.alertDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.ALERTS)
    )

    return toPaginatedRes(page, paging, toAdminAlert)
  }

  async countPending(): Promise<number> {
    return this.alertDbService.countDocuments({ status: AlertStatus.PENDING })
  }

  /**
   * Marks an alert answered.
   *
   * Delegates to `AlertsService.resolveAlert`, which is the same call the
   * trader's own acknowledgement makes — so the `TERMINAL_ALERT_RESOLVED` push
   * still reaches their extension and the card comes off their screen.
   */
  async resolve(
    alertId: string,
    request: AdminAlertActionReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminAlertListItem> {
    const alert = await this.require(alertId)

    if (alert.status === AlertStatus.RESOLVED) return toAdminAlert(alert)

    await this.alertsService.resolveAlert(alertId)

    await this.auditService.record({
      actor: admin.username,
      action: AdminAuditAction.ALERT_RESOLVED,
      targetType: AdminAuditTargetType.ALERT,
      targetId: alertId,
      reason: request.reason,
      metadata: {
        traderId: alert.traderId,
        terminalId: alert.terminalId,
        type: alert.type,
        amount: alert.amount
      },
      ip
    })

    this.logger.log(
      `Admin ${admin.username} resolved alert ${alertId} ` +
        `(${alert.type}, trader ${alert.traderId}): ${request.reason}`
    )

    const resolved = await this.require(alertId)

    return toAdminAlert(resolved)
  }

  /**
   * Removes an alert permanently.
   *
   * **The row's whole content goes onto the audit entry first.** An alert
   * records a discrepancy in somebody's money, and a deletion that left nothing
   * behind would erase the only evidence that the discrepancy existed — so the
   * list loses it and the trail keeps it, `metadata` and all.
   *
   * Ordered so a failed audit write cannot leave a deleted alert unrecorded:
   * the entry is written before the delete, not after. `AdminAuditService`
   * swallows its own failures by design, so this is the ordering rather than a
   * transaction — but a row recorded and then not deleted is recoverable, and a
   * row deleted and not recorded is not.
   */
  async delete(
    alertId: string,
    request: AdminAlertActionReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<void> {
    const alert = await this.require(alertId)

    await this.auditService.record({
      actor: admin.username,
      action: AdminAuditAction.ALERT_DELETED,
      targetType: AdminAuditTargetType.ALERT,
      targetId: alertId,
      reason: request.reason,
      // Everything, because after the next line this is all that is left of it.
      metadata: {
        traderId: alert.traderId,
        terminalId: alert.terminalId,
        type: alert.type,
        status: alert.status,
        amount: alert.amount,
        isRead: alert.isRead,
        alertMetadata: alert.metadata ?? null,
        createdAt: alert.createdAt?.toISOString() ?? null
      },
      ip
    })

    await this.alertDbService.deleteById(alertId)

    this.logger.warn(
      `Admin ${admin.username} deleted alert ${alertId} ` +
        `(${alert.type}, ${alert.amount} kopecks, trader ${alert.traderId}): ${request.reason}`
    )
  }

  private async require(alertId: string): Promise<StoredAlert> {
    return ensure(
      await this.alertDbService.findOne<StoredAlert>({ _id: alertId }),
      new NotFoundException(ERROR.ADMIN.ALERT_NOT_FOUND)
    )
  }

  /**
   * Alerts carry ids and amounts and nothing an operator would type as text —
   * their wording lives in the client, since the database stores a key and its
   * metadata rather than a sentence. A non-numeric term therefore matches
   * nothing, which is the honest answer rather than a regex over an enum.
   */
  private searchFilter(search: string | undefined): QueryFilter<Alert> {
    if (!search) return {}

    const asNumber = Number(search)
    if (!Number.isFinite(asNumber)) return { _id: null } as unknown as QueryFilter<Alert>

    return {
      $or: [{ traderId: asNumber }, { terminalId: asNumber }, { amount: asNumber }]
    } as QueryFilter<Alert>
  }
}
