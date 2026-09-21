import {
  AdminDepositKind,
  ERROR,
  type AdminDepositDetailRes,
  type AdminDepositRowItem,
  type AdminDepositsPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Injectable, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import {
  AdminDepositFeedDbService,
  type AdminDepositFeedFilter
} from 'src/modules/repositories/admin-feed-db/services'
import type { AdminDepositFeedRow } from 'src/modules/repositories/admin-feed-db/interfaces'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminDocumentsService } from 'src/modules/admin/services/admin-documents.service'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import { toAdminDepositRow, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

/**
 * Money coming in, on both rails, as one book.
 *
 * **They used to be two screens, and the split was ours rather than the
 * product's.** A user tops up with USDT or with hryvnia and neither they nor an
 * operator thinks of those as different features — and the rule that matters
 * most about them treats them as one thing: a new account is capped at ₴2 000
 * per top-up until **one settled deposit by either method** lifts it. A screen
 * showing only one rail cannot explain why somebody's cap lifted.
 *
 * Read-only for crypto, deliberately: a deposit settles against a blockchain
 * transaction, and the honest way to correct one that went wrong is an audited
 * balance correction, not editing a deposit into a state the chain does not
 * support. The two fiat interventions live in `AdminFiatDepositsService`, which
 * owns them because they delegate to the settlement service.
 */
@Injectable()
export class AdminDepositsService {
  constructor(
    private readonly feed: AdminDepositFeedDbService,
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly documents: AdminDocumentsService,
    private readonly usersService: AdminUsersService
  ) {}

  async list(request: AdminDepositsPageReq): Promise<AdminPaginatedRes<AdminDepositRowItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.feed.findPage(
      { kind: request.filter, search: request.search },
      toPageQuery(paging, ADMIN_SORTABLE.DEPOSITS)
    )

    return toPaginatedRes(page, paging, await this.namer(page.items))
  }

  /**
   * One deposit and what settled it.
   *
   * **Addressed by kind and id**, because the two ids come from different
   * collections and nothing guarantees they do not collide — an id alone would
   * be a lookup that is right almost always, which is the worst kind.
   */
  async detail(kind: AdminDepositKind, id: string): Promise<AdminDepositDetailRes> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(ERROR.ADMIN.RECORD_NOT_FOUND)

    const row = await this.rowFor(kind, id)
    if (row === null) throw new NotFoundException(ERROR.ADMIN.RECORD_NOT_FOUND)

    const [name, user, documents, fiat] = await Promise.all([
      this.namer([row]),
      this.usersService.userRow(row.telegramId),
      kind === AdminDepositKind.FIAT
        ? this.documents.forFiatDeposit(new Types.ObjectId(id))
        : Promise.resolve([]),
      kind === AdminDepositKind.FIAT ? this.fiatDepositDb.findById(id) : Promise.resolve(null)
    ])

    return {
      deposit: name(row),
      user,
      documents,
      // In full, and only here — see the note on the contract. An operator
      // reconciling this top-up is looking at the same payout in Transacto's
      // own panel, and a masked number matches nothing.
      recipientCard: fiat?.recipientCard ?? null,
      holdUntilAt: fiat?.holdUntilAt.toISOString() ?? null
    }
  }

  /**
   * One deposit as the panel's list holds it.
   *
   * Public because the realtime fan-out needs exactly this and must not build
   * it another way: a pushed row assembled by a second mapper is how a live
   * list and the same list after a refresh come to disagree.
   */
  async row(kind: AdminDepositKind, id: string): Promise<AdminDepositRowItem | null> {
    if (!Types.ObjectId.isValid(id)) return null

    const found = await this.rowFor(kind, id)
    if (found === null) return null

    return (await this.namer([found]))(found)
  }

  /**
   * One row, built by the same pipeline the list uses.
   *
   * Reading the collection directly and mapping it here would be a second
   * projection of the same deposit — and the unit conversion lives in the
   * pipeline, so the second one would be the one that shows a hundred times too
   * much.
   */
  private async rowFor(
    kind: AdminDepositKind,
    id: string
  ): Promise<AdminDepositFeedRow | null> {
    const { items } = await this.feed.findPage(
      { kind, id: new Types.ObjectId(id) } satisfies AdminDepositFeedFilter,
      { skip: 0, limit: 1, sort: { createdAt: -1 } }
    )

    return items[0] ?? null
  }

  private async namer(
    rows: readonly AdminDepositFeedRow[]
  ): Promise<(row: AdminDepositFeedRow) => AdminDepositRowItem> {
    const name = await this.usersService.namerFor(rows.map((row) => row.telegramId))

    return (row) => toAdminDepositRow(row, name(row.telegramId))
  }
}
