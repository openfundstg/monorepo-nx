import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminSaleAction,
  AdminWsEventNames,
  ERROR,
  SaleBlockReason,
  SaleEventType,
  TmaSaleStatus,
  type AdminPageReq,
  type AdminPaginatedRes,
  type AdminSaleActionReq,
  type AdminSaleListItem
} from '@transacto/contracts'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { StoredSale, TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'

/**
 * A stored order, as every read here returns it.
 *
 * The `_id` is part of the type rather than cast in at each call site — the
 * settlement services this delegates to take exactly this shape, and a cast
 * would only hide the day one of them stops doing so.
 */
import { SaleBlockService } from 'src/modules/telegram-mini-app/services/sale-block.service'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'
import { SaleReviewService } from 'src/modules/telegram-mini-app/services/sale-review.service'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { saleRefundSplit } from 'src/shared/utils'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import {
  escapeRegex,
  isSaleActionAllowed,
  toAdminSale,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/**
 * Which audit action each intervention writes.
 *
 * A lookup rather than a `switch` in the method, so adding an action to
 * {@link AdminSaleAction} fails to compile here until its audit meaning
 * is decided — which is the point at which somebody should be deciding it.
 */
const ACTION_AUDIT: Readonly<Record<AdminSaleAction, AdminAuditAction>> = {
  [AdminSaleAction.CANCEL]: AdminAuditAction.SALE_CANCELLED,
  [AdminSaleAction.BLOCK]: AdminAuditAction.SALE_BLOCKED,
  [AdminSaleAction.COMPLETE]: AdminAuditAction.SALE_COMPLETED,
  [AdminSaleAction.RESUME]: AdminAuditAction.SALE_RESUMED,
  [AdminSaleAction.RELEASE]: AdminAuditAction.SALE_RELEASED,
  [AdminSaleAction.RELEASE_JAR]: AdminAuditAction.SALE_JAR_RELEASED
}

/**
 * Listing sales, and intervening in one.
 *
 * **Every intervention delegates to the service that already owns it** —
 * `SaleCancelService`, `SaleBlockService`,
 * `SaleFacadeService`. That is deliberate and not negotiable: those
 * paths freeze and unfreeze stakes, retire terminals upstream, pay referrers
 * and push progress to the user's own screen. A second implementation here
 * would be a second settlement path for the same money, and the two would
 * diverge on the first change to either.
 *
 * What this service adds is the operator's reason, the audit row, and the push
 * to other open panels.
 */
@Injectable()
export class AdminSalesService {
  private readonly logger = new Logger(AdminSalesService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly cancelService: SaleCancelService,
    private readonly blockService: SaleBlockService,
    private readonly saleFacade: SaleFacadeService,
    // The two halves of a human review of a blocked order. Owned by the Mini
    // App module, because both move a user's frozen stake and push to their
    // own screen.
    private readonly reviewService: SaleReviewService,
    private readonly usersService: AdminUsersService,
    private readonly auditService: AdminAuditService,
    private readonly gateway: AdminGateway
  ) {}

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminSaleListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.saleDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.SALES)
    )

    const names = await this.usersService.namesFor(page.items.map((order) => order.telegramId))

    return toPaginatedRes(page, paging, (order) =>
      toAdminSale(order, names.get(order.telegramId) ?? String(order.telegramId))
    )
  }

  /**
   * Cancels, blocks or completes one order on an operator's say-so.
   *
   * The status check is advisory — each delegate re-checks under its own
   * idempotency gate — but it exists so the panel gets a clear 409 instead of a
   * silent no-op on an order that finished while the dialog was open.
   */
  async act(
    saleId: string,
    request: AdminSaleActionReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminSaleListItem> {
    const order = await this.saleDbService.findById(saleId)
    if (!order) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    // The same rule the row was rendered from, so the menu and the endpoint
    // cannot disagree. It is checked again here rather than trusted from the
    // client: the row may have moved since it was drawn, and an operator can
    // reach this endpoint without a menu at all.
    if (!isSaleActionAllowed(request.action, order))
      throw new ConflictException(ERROR.ADMIN.ORDER_NOT_ACTIONABLE)

    this.assertRefundWithinStake(request, order)

    await this.dispatch(request.action, saleId, order, request.refundCents)

    await this.auditService.record({
      actor: admin.username,
      action: ACTION_AUDIT[request.action],
      targetType: AdminAuditTargetType.SALE,
      targetId: order.publicId,
      reason: request.reason,
      metadata: {
        saleId,
        telegramId: order.telegramId,
        statusBefore: order.status,
        fiatAmount: order.fiatAmount,
        frozenUsdt: order.frozenUsdt,
        // Both figures, always. An override that happens to equal the computed
        // one is still a decision somebody made, and a row showing only the
        // amount paid cannot answer "was this the automatic number?".
        suggestedRefundCents: saleRefundSplit(order).refunded,
        ...(request.refundCents !== undefined ? { refundCents: request.refundCents } : {})
      },
      ip
    })

    this.logger.warn(
      `Admin ${admin.username} performed ${request.action} on sale ` +
        `${order.publicId} (was ${order.status}): ${request.reason}`
    )

    // Re-read rather than trusting the pre-action document: the delegates move
    // the status, the refund figures and sometimes the terminal link, and the
    // panel has to see what actually happened rather than what was asked for.
    const settled = await this.saleDbService.findById(saleId)
    if (!settled) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    return this.publish(settled)
  }

  /**
   * Refuses a refund larger than the order's own stake.
   *
   * `unfreezeBalance` moves money out of the frozen pot, so returning more than
   * was frozen leaves that pot permanently wrong — and paying somebody more
   * than their stake is a balance correction, which is its own audited action
   * with its own reason. Checked before anything is written.
   */
  private assertRefundWithinStake(
    request: AdminSaleActionReq,
    order: StoredSale
  ): void {
    if (request.refundCents === undefined) return
    if (request.refundCents > order.frozenUsdt)
      throw new BadRequestException(ERROR.ADMIN.REFUND_EXCEEDS_STAKE)
  }

  private async dispatch(
    action: AdminSaleAction,
    saleId: string,
    order: StoredSale,
    refundCents?: number
  ): Promise<void> {
    switch (action) {
      case AdminSaleAction.CANCEL:
        // With no override, the owner's own id, so it settles exactly as it
        // would if they had pressed the button themselves — same ownership
        // check, same arithmetic, same closing path when payments are still
        // outstanding.
        if (refundCents === undefined) {
          await this.cancelService.cancel(saleId, order.telegramId)
          return
        }

        // With one, straight to the settlement. `cancel()` is the *user's*
        // entry point: it decides between winding down and settling based on
        // outstanding payments, and an operator naming a figure has already
        // made that decision. The settlement itself is the same code either
        // way, so the refund arithmetic cannot diverge.
        await this.cancelService.settle(order, SaleEventType.STOPPED_BY_USER, refundCents)
        return

      case AdminSaleAction.BLOCK:
        // `ADMIN_DECISION` rather than one of the two automatic reasons: the
        // user is shown this, and telling them they broke a rule they did not
        // would be a lie the operator cannot correct.
        await this.blockService.block(order, SaleBlockReason.ADMIN_DECISION)
        return

      case AdminSaleAction.COMPLETE:
        // Idempotent, and the same call the automatic pipeline makes when a jar
        // fills — it commits the stake, credits turnover and pays the referrer.
        await this.saleFacade.completeSale(saleId)
        return

      case AdminSaleAction.RESUME:
        await this.reviewService.resume(order)
        return

      case AdminSaleAction.RELEASE:
        await this.reviewService.release(order, refundCents)
        return

      case AdminSaleAction.RELEASE_JAR:
        // Straight to the repository, and this is the one intervention where
        // that is right rather than a shortcut past a service. Nothing here
        // settles: no stake moves, no status changes, no terminal is touched.
        // The whole action is one timestamp saying an operator vouched for a
        // jar the bank would not vouch for — there is no owning service to
        // delegate to, because there is no operation to own.
        //
        // Keyed by the order, never by the card: `markJarClosedByCardId` is the
        // scraper reporting a fact about a jar, and covers every sale on it. An
        // operator has looked at one sale.
        if (!(await this.saleDbService.markJarClosedById(saleId))) {
          throw new ConflictException(ERROR.SALE.JAR_ALREADY_CLOSED)
        }
        return
    }
  }

  private async publish(
    order: TmaSale & { _id: { toString(): string } }
  ): Promise<AdminSaleListItem> {
    const names = await this.usersService.namesFor([order.telegramId])
    const item = toAdminSale(order, names.get(order.telegramId) ?? String(order.telegramId))

    this.gateway.emit(AdminWsEventNames.SALE_UPDATED, { order: item })

    return item
  }

  /**
   * Matches the codes an operator is given, plus the jar link.
   *
   * `publicId` is the code a user quotes to support, so it is the field this
   * box exists for; the drop link is here because a support ticket about a
   * suspicious jar arrives as a URL and nothing else.
   */
  private searchFilter(search: string | undefined): QueryFilter<TmaSale> {
    if (!search) return {}

    const pattern = new RegExp(escapeRegex(search), 'i')
    const asNumber = Number(search)

    return {
      $or: [
        { publicId: pattern },
        { dropLink: pattern },
        { receiverName: pattern },
        ...(Number.isFinite(asNumber)
          ? [{ telegramId: asNumber }, { cardId: asNumber }, { transactoTerminalId: asNumber }]
          : [])
      ]
    }
  }
}
