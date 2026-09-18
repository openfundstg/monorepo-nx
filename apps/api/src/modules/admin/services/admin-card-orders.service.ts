import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ERROR,
  SaleCardOrderState,
  SaleMethod,
  type AdminCardOrderListItem,
  type AdminCardOrderStatement,
  type AdminPageReq,
  type AdminPaginatedRes,
  type BankProvider
} from '@transacto/contracts'
import type { QueryFilter } from 'mongoose'
import type { ReadStream } from 'node:fs'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import {
  escapeRegex,
  toAdminCardOrder,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale, TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleStatementStorageService } from 'src/modules/telegram-mini-app/services/sale-statement-storage.service'

/** The states an operator has anything to do about. */
const OPEN = [SaleCardOrderState.DISPUTED, SaleCardOrderState.PROVEN_UNPAID] as const

/**
 * Disputed card-sale orders, as an operator reaches them.
 *
 * **This exists for one errand, and the errand decides the shape.** A dispute is
 * worked in Transacto's own panel, where the order is a number and nothing else
 * — no sale id, no user, no public code. Everything here is built to turn that
 * number back into the seller, the amount they denied, and the statement they
 * sent about it. That is why the lookup and the download are both addressed by
 * the order number rather than by anything of ours: an operator arrives holding
 * one thing, and a step that says "first find the sale" is the step that makes
 * this useless at three in the morning.
 *
 * It settles nothing. Appeals are closed in Transacto's panel by hand, by
 * deliberate decision; what this offers is the evidence to close them with.
 */
@Injectable()
export class AdminCardOrdersService {
  constructor(
    private readonly saleDb: TmaSaleDbService,
    private readonly storage: SaleStatementStorageService
  ) {}

  /**
   * The queue of disputes, as a page.
   *
   * **One row is one sale**, carrying its open order, and that is exact rather
   * than an approximation: a card sale's credential is created with
   * `max_open_orders: 1`, so a sale can only ever be waiting on one answer at a
   * time. Paginating sales is therefore paginating disputes. The oldest
   * matching order is taken if that cap ever slips upstream, so nothing
   * disappears from the queue — it merely shows the one that has waited longest.
   *
   * **The search box is the errand this screen exists for.** An operator
   * arrives from Transacto's panel holding a number and nothing else; typing it
   * here is the lookup, which is why there is no separate find-by-id route to
   * remember.
   */
  async list(query: AdminPageReq): Promise<AdminPaginatedRes<AdminCardOrderListItem>> {
    const filter = this.filterFor(query)
    const page = await this.saleDb.findPage(
      filter,
      toPageQuery({ ...query, limit: clampLimit(query.limit) }, ADMIN_SORTABLE.CARD_ORDERS)
    )

    return toPaginatedRes(page, query, (sale) => toAdminCardOrder(sale, this.openOrderOf(sale)))
  }

  /**
   * Which sales the page is drawn from.
   *
   * Search matches what an operator actually carries in from somewhere else —
   * Transacto's order number, or the public code a seller quoted to support.
   * **The state is not searchable as text**: it is an enum, and typing
   * "disputed" must not half-match a code.
   */
  private filterFor(query: AdminPageReq): QueryFilter<TmaSale> {
    const base: QueryFilter<TmaSale> = {
      saleMethod: SaleMethod.CARD,
      'cardOrders.state': { $in: [...OPEN] }
    }

    const search = query.search?.trim()
    if (!search) return base

    const asNumber = Number(search)
    // `Number('')` is 0 and `Number('abc')` is NaN — neither is an order, and an
    // emptied box must not match order zero.
    const byOrderId = Number.isSafeInteger(asNumber) && asNumber > 0 ? [{ 'cardOrders.orderId': asNumber }] : []

    return {
      ...base,
      $or: [...byOrderId, { publicId: { $regex: escapeRegex(search), $options: 'i' } }]
    }
  }

  /** The order this sale is waiting on — the oldest of them, if ever more than one. */
  private openOrderOf(sale: TmaSale): TmaSaleCardOrder {
    const open = (sale.cardOrders ?? []).filter((cardOrder) =>
      (OPEN as readonly SaleCardOrderState[]).includes(cardOrder.state)
    )

    // The filter guaranteed at least one; `at(0)!` would be the same claim
    // without saying so, and a sale that somehow has none is a bug worth seeing
    // rather than a crash in a mapper.
    return open[0] ?? (sale.cardOrders ?? [])[0]
  }

  /**
   * The statement uploaded against one order, as bytes to download.
   *
   * The **latest** one, because that is the document the verdict was reached on;
   * the earlier attempts are listed beside it and were refused. `null` when
   * there is none, or when the file is gone — a deploy before the volume
   * existed, or a retention sweep.
   */
  async statementFor(orderId: number): Promise<{ stream: ReadStream; fileName: string } | null> {
    const sale = await this.saleDb.findByCardOrderId(orderId)
    const cardOrder = sale?.cardOrders?.find((candidate) => candidate.orderId === orderId)

    if (!sale || !cardOrder) throw new NotFoundException(ERROR.SALE_CARD.ORDER_NOT_FOUND)

    const latest = (cardOrder.statements ?? []).at(-1)
    if (!latest) return null

    // Past its retention: the record of what it said is still on the row, and
    // the bytes are deliberately gone. A 404 says so; an empty download would
    // read as a broken feature.
    if (latest.purgedAt !== null) return null

    const stream = this.storage.read(latest.storedName)
    if (stream === null) return null

    // Named for the order rather than for the statement, because the operator
    // is filing it against an appeal and that is the number on the appeal.
    return { stream, fileName: `statement-order-${orderId}.pdf` }
  }
}
