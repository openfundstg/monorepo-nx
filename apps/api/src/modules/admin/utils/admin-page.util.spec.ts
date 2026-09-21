import { AdminSortDirection } from '@transacto/contracts'
import { ADMIN_PAGE } from 'src/modules/admin/constants'
import { startOfToday, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

describe('toPageQuery', () => {
  const SORTABLE = ['createdAt', 'balance'] as const

  it('turns a one-based page into an offset', () => {
    expect(toPageQuery({ page: 3, limit: 20 }, SORTABLE)).toMatchObject({ skip: 40, limit: 20 })
  })

  it('defaults to the first page', () => {
    expect(toPageQuery({}, SORTABLE).skip).toBe(0)
    expect(toPageQuery({}, SORTABLE).limit).toBe(ADMIN_PAGE.DEFAULT_LIMIT)
  })

  it('sorts descending unless told otherwise', () => {
    expect(toPageQuery({ sort: 'balance' }, SORTABLE).sort).toEqual({ balance: -1 })
    expect(
      toPageQuery({ sort: 'balance', direction: AdminSortDirection.ASC }, SORTABLE).sort
    ).toEqual({ balance: 1 })
  })

  /**
   * The allow-list is the whole point: a free `sort` lets a caller order by an
   * unindexed field and turn a paged read into a collection scan.
   */
  it('ignores a sort field the resource does not offer', () => {
    expect(toPageQuery({ sort: 'apiToken' }, SORTABLE).sort).toEqual({ createdAt: -1 })
  })

  it('falls back rather than rejecting, so a stale bookmark still works', () => {
    expect(toPageQuery({ sort: 'a-field-we-removed' }, SORTABLE).sort).toEqual({ createdAt: -1 })
  })
})

describe('toPaginatedRes', () => {
  it('maps the rows and reports the whole match, not the page size', () => {
    const res = toPaginatedRes(
      { items: [{ n: 1 }, { n: 2 }], total: 812 },
      { page: 2, limit: 25 },
      (row) => row.n
    )

    expect(res).toEqual({ items: [1, 2], total: 812, page: 2, limit: 25 })
  })

  it('defaults the page and limit when the request carried neither', () => {
    const res = toPaginatedRes({ items: [], total: 0 }, {}, (row) => row)

    expect(res).toMatchObject({ page: 1, limit: ADMIN_PAGE.DEFAULT_LIMIT })
  })
})

describe('startOfToday', () => {
  it('is midnight in the server timezone, not UTC', () => {
    // An operator reading "12 completed today" means their day. A counter that
    // rolls over at 03:00 local answers a question nobody asked.
    const midnight = startOfToday()

    expect(midnight.getHours()).toBe(0)
    expect(midnight.getMinutes()).toBe(0)
    expect(midnight.getSeconds()).toBe(0)
    expect(midnight.getDate()).toBe(new Date().getDate())
  })
})
