import {
  TmaDepositStatus,
  type AdminDepositListItem,
  type AdminPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Injectable } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaDeposit } from 'src/modules/repositories/tma-deposit-db/schemas'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import { escapeRegex, toAdminDeposit, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'

/**
 * Listing crypto deposits.
 *
 * Read-only, and deliberately so. A deposit is settled against a blockchain
 * transaction, and the honest way to correct one that went wrong is a manual
 * balance correction with a reason attached — which is audited — rather than
 * editing a deposit into a state the chain does not support.
 */
@Injectable()
export class AdminDepositsService {
  constructor(
    private readonly depositDbService: TmaDepositDbService,
    private readonly usersService: AdminUsersService
  ) {}

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminDepositListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.depositDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.DEPOSITS)
    )

    const names = await this.usersService.namesFor(page.items.map((deposit) => deposit.telegramId))

    return toPaginatedRes(page, paging, (deposit) =>
      toAdminDeposit(deposit, names.get(deposit.telegramId) ?? String(deposit.telegramId))
    )
  }

  /**
   * Matched against the transaction hash and the depositor's id.
   *
   * The hash is what a user pastes into support when a deposit has not landed,
   * so it is the field this box mainly exists for. Status is not searchable as
   * text — it is an enum, and typing "pending" should not half-match a hash.
   */
  private searchFilter(search: string | undefined): QueryFilter<TmaDeposit> {
    if (!search) return {}

    const pattern = new RegExp(escapeRegex(search), 'i')
    const asNumber = Number(search)
    const asStatus = Object.values(TmaDepositStatus).find(
      (status) => status === search.toUpperCase()
    )

    return {
      $or: [
        { txId: pattern },
        ...(asStatus ? [{ status: asStatus }] : []),
        ...(Number.isFinite(asNumber) ? [{ telegramId: asNumber }] : [])
      ]
    }
  }
}
