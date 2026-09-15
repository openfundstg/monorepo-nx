import {
  AdminAuditAction,
  AdminAuditTargetType,
  ERROR,
  type AdminPageReq,
  type AdminPaginatedRes,
  type AdminSafeBoxListItem,
  type AdminSetTraderActiveReq,
  type AdminTraderListItem
} from '@transacto/contracts'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import type { Trader } from 'src/modules/repositories/trader-db/schemas'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { AlertDbService } from 'src/modules/repositories/alerts-db/services'
import { SafeBoxDbService } from 'src/modules/repositories/safe-box-db/services'
import type { SafeBoxDeposit } from 'src/modules/repositories/safe-box-db/schemas'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { toAdminSafeBox, toAdminTrader, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

/**
 * The trader side of the panel: accounts, their alerts, and money held in the
 * safe box.
 *
 * One service because all three are read through the same trader, and because
 * a trader row is meaningless in the panel without the two counts beside it —
 * "is this account healthy" is a question about all three at once.
 */
@Injectable()
export class AdminTradersService {
  private readonly logger = new Logger(AdminTradersService.name)

  constructor(
    private readonly traderDbService: TraderDbService,
    private readonly terminalDbService: TerminalDbService,
    private readonly alertDbService: AlertDbService,
    private readonly safeBoxDbService: SafeBoxDbService,
    private readonly auditService: AdminAuditService
  ) {}

  // --- Reads ----------------------------------------------------------------

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminTraderListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const filter: QueryFilter<Trader> = {}
    const asNumber = Number(request.search)
    if (request.search && Number.isFinite(asNumber)) filter.traderId = asNumber

    const page = await this.traderDbService.findPage(
      filter,
      toPageQuery(paging, ADMIN_SORTABLE.TRADERS)
    )

    // Two aggregations for the whole page rather than two counts per row.
    const traderIds = page.items.map((trader) => trader.traderId)
    const [terminals, pendingAlerts] = await Promise.all([
      this.terminalDbService.countByTraderIds(traderIds),
      this.alertDbService.countPendingByTraderIds(traderIds)
    ])

    return toPaginatedRes(page, paging, (trader) =>
      toAdminTrader(
        trader,
        terminals[trader.traderId] ?? { total: 0, enabled: 0 },
        pendingAlerts[trader.traderId] ?? 0
      )
    )
  }

  async listSafeBox(request: AdminPageReq): Promise<AdminPaginatedRes<AdminSafeBoxListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.safeBoxDbService.findPage(
      this.numericFilter<SafeBoxDeposit>(request.search, [
        'traderId',
        'terminalId',
        'amount',
        'linkedOrderId'
      ]),
      toPageQuery(paging, ADMIN_SORTABLE.SAFE_BOX)
    )

    return toPaginatedRes(page, paging, toAdminSafeBox)
  }

  // --- Writes ---------------------------------------------------------------

  /**
   * Activates or deactivates a trader account.
   *
   * Delegates to the DB service's own methods, which emit `TRADER_DEACTIVATED`
   * to that trader's extension so an account switched off here disconnects
   * rather than carrying on until its next reload.
   */
  async setActive(
    traderId: number,
    request: AdminSetTraderActiveReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminTraderListItem> {
    const trader = await this.traderDbService.findByTraderId(traderId)
    if (!trader) throw new NotFoundException(ERROR.ADMIN.TRADER_NOT_FOUND)

    if (request.isActive) await this.traderDbService.activateTrader(traderId)
    else await this.traderDbService.deactivateTrader(traderId)

    await this.auditService.record({
      actor: admin.username,
      action: request.isActive
        ? AdminAuditAction.TRADER_ACTIVATED
        : AdminAuditAction.TRADER_DEACTIVATED,
      targetType: AdminAuditTargetType.TRADER,
      targetId: String(traderId),
      reason: request.reason,
      metadata: { isActiveBefore: trader.isActive },
      ip
    })

    this.logger.warn(
      `Admin ${admin.username} ${request.isActive ? 'activated' : 'deactivated'} ` +
        `trader ${traderId}: ${request.reason}`
    )

    const [terminals, pendingAlerts] = await Promise.all([
      this.terminalDbService.countByTraderIds([traderId]),
      this.alertDbService.countPendingByTraderIds([traderId])
    ])

    // The pre-write document with the new flag folded in, rather than a
    // re-read: the two DB methods above return nothing, and a second lookup
    // would answer a question we already know the answer to.
    return toAdminTrader(
      { ...trader, isActive: request.isActive },
      terminals[traderId] ?? { total: 0, enabled: 0 },
      pendingAlerts[traderId] ?? 0
    )
  }

  /**
   * A search box over collections whose only searchable fields are numbers.
   *
   * Alerts and safe-box rows carry ids and amounts and nothing an operator
   * would type as text — the alert's own wording lives in the client, since the
   * database stores a key and its metadata rather than a sentence. So a
   * non-numeric term matches nothing here, which is the honest answer rather
   * than a regex over an enum.
   */
  private numericFilter<T>(search: string | undefined, fields: readonly string[]): QueryFilter<T> {
    if (!search) return {} as QueryFilter<T>

    const asNumber = Number(search)

    // A term that is not a number matches nothing, and says so by filtering on
    // an `_id` that cannot exist. Returning `{}` instead would answer a failed
    // search with the unfiltered list, which reads as "everything matched".
    if (!Number.isFinite(asNumber)) return { _id: null } as unknown as QueryFilter<T>

    return { $or: fields.map((field) => ({ [field]: asNumber })) } as unknown as QueryFilter<T>
  }
}
