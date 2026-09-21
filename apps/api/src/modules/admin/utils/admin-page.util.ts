import { AdminSortDirection, SaleMethod } from '@transacto/contracts'
import type { AdminPageReq, AdminPaginatedRes } from '@transacto/contracts'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'
import { ADMIN_PAGE, DISPUTED_CARD_ORDER_STATES } from 'src/modules/admin/constants'

/**
 * Turns a validated page request into the offset-and-sort the repository layer
 * takes.
 *
 * `sortable` is the allow-list for this particular resource; anything outside
 * it falls back to the first entry rather than being rejected. A sort field the
 * server no longer offers is a stale bookmark, not an attack, and answering it
 * with a 400 breaks a link that used to work.
 */
export const toPageQuery = (
  request: AdminPageReq,
  sortable: readonly string[],
  fallback = sortable[0]
): PageQuery => {
  const limit = request.limit ?? ADMIN_PAGE.DEFAULT_LIMIT
  const page = request.page ?? 1
  const field = request.sort && sortable.includes(request.sort) ? request.sort : fallback
  const direction = request.direction ?? ADMIN_PAGE.DEFAULT_DIRECTION

  return {
    skip: (page - 1) * limit,
    limit,
    sort: { [field]: direction === AdminSortDirection.ASC ? 1 : -1 }
  }
}

/** Wraps a repository page in the envelope the panel reads, mapping rows on the way. */
export const toPaginatedRes = <TDoc, TItem>(
  page: Page<TDoc>,
  request: AdminPageReq,
  map: (doc: TDoc) => TItem
): AdminPaginatedRes<TItem> => ({
  items: page.items.map(map),
  total: page.total,
  page: request.page ?? 1,
  limit: request.limit ?? ADMIN_PAGE.DEFAULT_LIMIT
})

/**
 * Midnight today, in the server's timezone.
 *
 * The overview's "today" figures. Deliberately the server's day rather than
 * UTC: an operator in Kyiv reading "12 completed today" means their day, and a
 * counter that rolls over at 03:00 local answers a question nobody asked.
 */
export const startOfToday = (): Date => {
  const now = new Date()

  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Sales waiting on a person, as a Mongo filter.
 *
 * Built here rather than at each caller so the dispute chip and the dashboard's
 * dispute count cannot ask different questions — a figure that disagrees with
 * the list it links to is worse than no figure.
 */
export const disputedCardSaleFilter = (): Record<string, unknown> => ({
  saleMethod: SaleMethod.CARD,
  'cardOrders.state': { $in: [...DISPUTED_CARD_ORDER_STATES] }
})
