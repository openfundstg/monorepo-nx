import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminWsEventNames,
  ERROR,
  type AdminOrderListItem,
  type AdminPageReq,
  type AdminPaginatedRes,
  type AdminSetTerminalStateReq,
  type AdminTerminalHistoryItem,
  type AdminTerminalListItem
} from '@transacto/contracts'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import type { TerminalHistory } from 'src/modules/repositories/terminal-history-db/schemas'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import type { Order } from 'src/modules/repositories/order-db/schemas'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { TerminalActivationService, TerminalDeactivationService } from 'src/modules/terminal'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import {
  escapeRegex,
  toAdminOrder,
  toAdminTerminal,
  toAdminTerminalHistory,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/** The reason string that reaches every log line these actions produce. */
const ADMIN_REASON = 'Admin panel'

/**
 * Terminals, their scraping history, and the Transacto orders routed to them.
 *
 * Three collections in one service because they are one screen's worth of
 * question — "what is this jar doing?" — and splitting them would mean three
 * services all resolving the same terminal.
 *
 * **Both state changes delegate.** `TerminalDeactivationService` and
 * `TerminalActivationService` already own the ordering constraints that make a
 * terminal's local and upstream states agree; a second implementation here
 * would be one that forgets `enable_orders`, and the next terminals sync would
 * quietly undo whatever the operator asked for.
 */
@Injectable()
export class AdminTerminalsService {
  private readonly logger = new Logger(AdminTerminalsService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly historyDbService: TerminalHistoryDbService,
    private readonly orderDbService: OrderDbService,
    private readonly traderDbService: TraderDbService,
    private readonly deactivationService: TerminalDeactivationService,
    private readonly activationService: TerminalActivationService,
    private readonly auditService: AdminAuditService,
    private readonly gateway: AdminGateway
  ) {}

  // --- Reads ----------------------------------------------------------------

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminTerminalListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.terminalDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.TERMINALS, 'updatedAt')
    )

    return toPaginatedRes(page, paging, toAdminTerminal)
  }

  /** The scraper's audit trail for one jar, newest first. */
  async history(
    cardId: number,
    request: AdminPageReq
  ): Promise<AdminPaginatedRes<AdminTerminalHistoryItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.historyDbService.findPage(
      { cardId } as QueryFilter<TerminalHistory>,
      toPageQuery(paging, ADMIN_SORTABLE.TERMINAL_HISTORY, 'timestamp')
    )

    return toPaginatedRes(page, paging, toAdminTerminalHistory)
  }

  /** Transacto orders, across every terminal or filtered down to one. */
  async listOrders(request: AdminPageReq): Promise<AdminPaginatedRes<AdminOrderListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.orderDbService.findPage(
      this.orderSearchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.ORDERS)
    )

    return toPaginatedRes(page, paging, toAdminOrder)
  }

  // --- Writes ---------------------------------------------------------------

  /**
   * Moves one or both of a terminal's flags.
   *
   * The two are handled by four separate delegate calls rather than a single
   * `setEnabled(x)`, because `enabled` and `acceptingOrders` are genuinely
   * different operations upstream — a teardown rewrites turnover caps and
   * clears Redis, while withholding routing does neither.
   *
   * `enabled` is applied before `acceptingOrders` when both are present: a
   * teardown resets `acceptingOrders` to `true` as part of its own contract, so
   * the other order would have the teardown overwrite the flag the operator
   * just set.
   */
  async setState(
    cardId: number,
    request: AdminSetTerminalStateReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminTerminalListItem> {
    if (request.enabled === undefined && request.acceptingOrders === undefined)
      throw new BadRequestException(ERROR.ADMIN.NO_STATE_CHANGE)

    const terminal = await this.terminalDbService.findOne({ cardId })
    if (!terminal) throw new NotFoundException(ERROR.TERMINAL.NOT_FOUND)

    const trader = await this.traderDbService.findByTraderId(terminal.traderId)
    // Without the token nothing can be said upstream, and a local-only flip is
    // undone by the next terminals sync — so this is a refusal, not a partial
    // success the operator would have to discover for themselves.
    if (!trader) throw new NotFoundException(ERROR.ADMIN.TRADER_NOT_FOUND)

    const request$ = {
      terminalId: terminal.terminalId ?? null,
      traderId: terminal.traderId,
      cardId,
      reason: ADMIN_REASON,
      apiToken: trader.apiToken
    }

    if (request.enabled === true) await this.activationService.activate(request$)
    if (request.enabled === false) await this.deactivationService.deactivate(request$)

    if (request.acceptingOrders === true) await this.activationService.resumeRouting(request$)
    if (request.acceptingOrders === false) await this.deactivationService.stopRouting(request$)

    await Promise.all(
      this.auditActions(request).map((action) =>
        this.auditService.record({
          actor: admin.username,
          action,
          targetType: AdminAuditTargetType.TERMINAL,
          targetId: String(cardId),
          reason: request.reason,
          metadata: {
            traderId: terminal.traderId,
            terminalId: terminal.terminalId ?? null,
            terminalName: terminal.terminalName,
            enabledBefore: terminal.enabled,
            acceptingOrdersBefore: terminal.acceptingOrders ?? true
          },
          ip
        })
      )
    )

    this.logger.warn(
      `Admin ${admin.username} changed terminal card_id ${cardId} ` +
        `(enabled: ${request.enabled ?? 'unchanged'}, ` +
        `acceptingOrders: ${request.acceptingOrders ?? 'unchanged'}): ${request.reason}`
    )

    const updated = await this.terminalDbService.findOne({ cardId })
    if (!updated) throw new NotFoundException(ERROR.TERMINAL.NOT_FOUND)

    const item = toAdminTerminal(updated)
    this.gateway.emit(AdminWsEventNames.TERMINAL_UPDATED, { terminal: item })

    return item
  }

  /**
   * One audit row per flag actually moved.
   *
   * Two rows for a request that moves both, rather than one row with a
   * composite action: the trail is read by filtering on `action`, and an action
   * meaning "some combination of two things" is one nobody can filter on.
   */
  private auditActions(request: AdminSetTerminalStateReq): AdminAuditAction[] {
    return [
      ...(request.enabled === true ? [AdminAuditAction.TERMINAL_ENABLED] : []),
      ...(request.enabled === false ? [AdminAuditAction.TERMINAL_DISABLED] : []),
      ...(request.acceptingOrders === true ? [AdminAuditAction.TERMINAL_ORDERS_RESUMED] : []),
      ...(request.acceptingOrders === false ? [AdminAuditAction.TERMINAL_ORDERS_PAUSED] : [])
    ]
  }

  private searchFilter(search: string | undefined): QueryFilter<Terminal> {
    if (!search) return {}

    const pattern = new RegExp(escapeRegex(search), 'i')
    const asNumber = Number(search)

    return {
      $or: [
        { terminalName: pattern },
        { cred3: pattern },
        ...(Number.isFinite(asNumber)
          ? [{ cardId: asNumber }, { terminalId: asNumber }, { traderId: asNumber }]
          : [])
      ]
    }
  }

  /**
   * Orders carry no text worth matching except their upstream string id, so a
   * non-numeric term is only ever tried against that.
   */
  private orderSearchFilter(search: string | undefined): QueryFilter<Order> {
    if (!search) return {}

    const asNumber = Number(search)

    return {
      $or: [
        { orderStringId: new RegExp(escapeRegex(search), 'i') },
        ...(Number.isFinite(asNumber)
          ? [{ orderId: asNumber }, { cardId: asNumber }, { traderId: asNumber }]
          : [])
      ]
    }
  }
}
