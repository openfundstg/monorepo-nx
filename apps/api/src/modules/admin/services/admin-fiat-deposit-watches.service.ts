import {
  FiatDepositWatchMode,
  type AdminFiatDepositWatchListItem,
  type AdminPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Injectable } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TmaFiatDepositWatchDbService } from 'src/modules/repositories/tma-fiat-deposit-watch-db/services'
import type { TmaFiatDepositWatch } from 'src/modules/repositories/tma-fiat-deposit-watch-db/schemas'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import { toAdminFiatDepositWatch, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

/**
 * The demand Transacto's book is not meeting.
 *
 * Read-only, and unlike the other read-only lists here that is not a caution —
 * there is genuinely nothing an operator could do to one of these rows that
 * would help the person who wrote it. What helps is a payout in that range,
 * which is created in Transacto's panel. So this screen answers one question:
 * what are people waiting for, and how long have they waited.
 *
 * Sorted by `lastNotifiedAt` it answers a sharper one — which requests have
 * never once been able to fire.
 */
@Injectable()
export class AdminFiatDepositWatchesService {
  constructor(
    private readonly watchDbService: TmaFiatDepositWatchDbService,
    private readonly usersService: AdminUsersService
  ) {}

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminFiatDepositWatchListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.watchDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.FIAT_DEPOSIT_WATCHES)
    )

    const names = await this.usersService.namesFor(page.items.map((watch) => watch.telegramId))

    return toPaginatedRes(page, paging, (watch) =>
      toAdminFiatDepositWatch(watch, names.get(watch.telegramId) ?? String(watch.telegramId))
    )
  }

  /**
   * Matched against the requester's id and the mode.
   *
   * There is no free text on one of these rows — a request is two numbers and a
   * person — so the search box exists to answer "what did *this* user ask for",
   * which an operator arrives from the users list already knowing the id of.
   * The mode is an enum and is matched whole rather than partially, for the
   * reason every other list here states: a substring match on a status is a
   * substring match on everything else too.
   *
   * **A term matching neither filters on an impossible `_id`, never `{}` and
   * never an empty `$or`.** The sibling lists can always fall back on one
   * unconditional clause because they have a hash or a card to match; this one
   * has nothing, so both clauses are conditional and both can be absent at once.
   * `{ $or: [] }` is a `BadValue` from Mongo — a search for `abc` would be a
   * 500 — and `{}` would answer a failed search with the unfiltered list, which
   * reads as "everything matched". `admin-traders.service.ts` takes the same
   * way out for the same reason.
   */
  private searchFilter(search: string | undefined): QueryFilter<TmaFiatDepositWatch> {
    if (!search) return {}

    // `search`, not `escapeRegex(search)`: nothing here becomes a pattern, and
    // the escaping turns `1.5` into `1\.5`, which is `NaN`.
    const asNumber = Number(search)
    const asMode = Object.values(FiatDepositWatchMode).find(
      (mode) => mode === search.toUpperCase()
    )

    const clauses = [
      ...(asMode ? [{ mode: asMode }] : []),
      ...(Number.isFinite(asNumber) ? [{ telegramId: asNumber }] : [])
    ]

    return clauses.length === 0 ? { _id: null } : { $or: clauses }
  }
}
