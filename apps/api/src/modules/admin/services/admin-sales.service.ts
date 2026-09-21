import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminSaleAction,
  AdminSaleFilter,
  AdminWsEventNames,
  ERROR,
  SaleBlockReason,
  SaleEventType,
  SaleMethod,
  TmaSaleStatus,
  type AdminPaginatedRes,
  type AdminSaleActionReq,
  type AdminSaleDetailRes,
  type AdminSaleListItem,
  type AdminSalesPageReq
} from '@transacto/contracts'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common'
import { Types, type QueryFilter } from 'mongoose'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
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
import { containsRegex, saleRefundSplit } from 'src/shared/utils'
import { ADMIN_PAGE, ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { AdminDocumentsService } from 'src/modules/admin/services/admin-documents.service'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import {
  bookFilterClauses,
  disputedCardSaleFilter,
  isSaleActionAllowed,
  toAdminOrder,
  toAdminSale,
  toAdminSaleCardOrder,
  toAdminSaleHistory,
  toAdminTerminal,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/**
 * What each chip selects.
 *
 * A `Record` rather than a `switch` with a default, for the same reason
 * `ACTION_AUDIT` below is one: a member added to {@link AdminSaleFilter} must
 * fail to compile here until somebody decides what it selects. A default branch
 * would answer a new chip with the whole book, which reads as a filter that
 * does nothing — indistinguishable from one that matched everything.
 */
const SLICE_FILTERS: Readonly<Record<AdminSaleFilter, () => QueryFilter<TmaSale>>> = {
  // A sale written before the two methods existed is a jar sale: that is what
  // every sale was. A lean read applies no default, so the absence has to be
  // matched explicitly rather than left to one.
  [AdminSaleFilter.JAR]: () => ({
    $or: [{ saleMethod: SaleMethod.JAR }, { saleMethod: { $exists: false } }]
  }),
  [AdminSaleFilter.CARD]: () => ({ saleMethod: SaleMethod.CARD }),
  [AdminSaleFilter.DISPUTED]: disputedCardSaleFilter
}

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
    // Read-only, both of them: a sale's page shows the terminal it is bound to
    // and the orders routed at it, and changing either is the terminals
    // service's business rather than this one's.
    private readonly terminalDbService: TerminalDbService,
    private readonly orderDbService: OrderDbService,
    private readonly documents: AdminDocumentsService,
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

  async list(request: AdminSalesPageReq): Promise<AdminPaginatedRes<AdminSaleListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.saleDbService.findPage(
      this.filterFor(request),
      toPageQuery(paging, ADMIN_SORTABLE.SALES)
    )

    const name = await this.usersService.namerFor(page.items.map((order) => order.telegramId))

    return toPaginatedRes(page, paging, (order) => toAdminSale(order, name(order.telegramId)))
  }

  /**
   * One sale and everything attached to it.
   *
   * **Assembled rather than linked to**, which is the whole reason this exists.
   * Working a complaint used to mean copying the seller's id into the users
   * list, the card id into the terminals list, the order number into a third
   * screen and the sale's code into a fourth — four navigations to answer one
   * question, each of them a chance to paste the wrong number.
   *
   * Everything here is read fresh from the service that owns it, so this page
   * cannot contradict the lists it links to.
   */
  async detail(id: string): Promise<AdminSaleDetailRes> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    const sale = await this.saleDbService.findById(id)
    if (sale === null) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    const [name, user, terminal, orders, documents] = await Promise.all([
      this.usersService.namerFor([sale.telegramId]),
      this.usersService.userRow(sale.telegramId),
      // By `cardId` rather than by the sale's `transactoTerminalId`: the card is
      // what a terminal is filed under here and what its history is keyed by,
      // and a sale bound before the upstream id came back has the first and not
      // the second.
      sale.cardId === null
        ? Promise.resolve(null)
        : this.terminalDbService.findOne({ cardId: sale.cardId }),
      // `findPage`, not `findRecentByCard`: the paged read is the one that
      // carries `_id`, and the mapper needs it to address a row.
      sale.cardId === null
        ? Promise.resolve({ items: [], total: 0 })
        : this.orderDbService.findPage(
            { cardId: sale.cardId },
            { skip: 0, limit: ADMIN_PAGE.DETAIL_PREVIEW, sort: { createdAt: -1 } }
          ),
      this.documents.forSale(sale._id)
    ])

    return {
      sale: toAdminSale(sale, name(sale.telegramId)),
      user,
      cardOrders: (sale.cardOrders ?? []).map(toAdminSaleCardOrder),
      transactoOrders: orders.items.map(toAdminOrder),
      terminal: terminal === null ? null : toAdminTerminal(terminal),
      documents,
      // The sale's own timeline, already on the document. A jar sale's entries
      // are the scraper's observations and a card sale's are assertions and
      // what corroborated them — `evidence` is what says which, and it is the
      // whole reason this reaches the panel at all.
      history: (sale.events ?? []).map(toAdminSaleHistory)
    }
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
    const name = await this.usersService.namerFor([order.telegramId])
    const item = toAdminSale(order, name(order.telegramId))

    this.gateway.emit(AdminWsEventNames.SALE_UPDATED, { order: item })

    return item
  }

  /**
   * The slice and the search, combined without either eating the other.
   *
   * `$and` rather than a spread: both halves may use `$or`, and a spread would
   * leave whichever came second — which on the dispute queue would quietly
   * widen a filtered list back to the whole book.
   */
  private filterFor(request: AdminSalesPageReq): QueryFilter<TmaSale> {
    const clauses = [
      this.sliceFilter(request.filter),
      // A sale carries a hryvnia target and a USDT stake, and "over ₴5 000" and
      // "staking over 100 USDT" are different questions about the same row.
      bookFilterClauses(request, {
        date: 'createdAt',
        uah: 'fiatAmount',
        usdt: 'frozenUsdt'
      }),
      this.searchFilter(request.search)
    ].filter((clause) => Object.keys(clause).length > 0)

    if (clauses.length === 0) return {}
    if (clauses.length === 1) return clauses[0]

    return { $and: clauses }
  }

  /**
   * Which slice of the book the chips asked for.
   *
   * **The dispute queue is a filter here rather than a screen of its own**, and
   * that is the whole reason this parameter exists. It was a screen of its own,
   * which meant an operator arriving from Transacto's panel with an order
   * number could reach the dispute and not the sale around it — the seller, the
   * terminal, the stake, the other orders. One list, one search box, one row
   * that carries its own card order.
   *
   * Absent is the whole book — there is no `ALL` member, for the reason
   * {@link AdminSaleFilter} gives.
   */
  private sliceFilter(filter: AdminSaleFilter | undefined): QueryFilter<TmaSale> {
    return filter === undefined ? {} : SLICE_FILTERS[filter]()
  }

  /**
   * Matches the codes an operator is given, plus the jar link.
   *
   * `publicId` is the code a user quotes to support, so it is the field this
   * box exists for; the drop link is here because a support ticket about a
   * suspicious jar arrives as a URL and nothing else.
   *
   * **`cardOrders.orderId` is here because it is the one thing an operator
   * arrives from Transacto's panel holding.** That lookup used to live on a
   * separate screen; folding it in is what lets one search box answer both
   * "find me this sale" and "find me this dispute".
   */
  private searchFilter(search: string | undefined): QueryFilter<TmaSale> {
    if (!search) return {}

    const pattern = containsRegex(search)
    const asNumber = Number(search)
    // `Number('')` is 0 and `Number('abc')` is NaN — neither is an order, and
    // an emptied box must not match order zero.
    const numeric = Number.isSafeInteger(asNumber) && asNumber > 0

    return {
      $or: [
        { publicId: pattern },
        { dropLink: pattern },
        { receiverName: pattern },
        ...(numeric
          ? [
              { telegramId: asNumber },
              { cardId: asNumber },
              { transactoTerminalId: asNumber },
              { 'cardOrders.orderId': asNumber }
            ]
          : [])
      ]
    }
  }
}
