import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminFiatDepositAction,
  ERROR,
  TmaFiatDepositStatus,
  type AdminFiatDepositActionReq,
  type AdminFiatDepositListItem,
  type AdminPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaFiatDeposit } from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import { FiatDepositSettlementService } from 'src/modules/telegram-mini-app/services/fiat-deposit-settlement.service'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import {
  escapeRegex,
  toAdminFiatDeposit,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/** Which audit action each intervention writes. */
const ACTION_AUDIT: Readonly<Record<AdminFiatDepositAction, AdminAuditAction>> = {
  [AdminFiatDepositAction.COMPLETE]: AdminAuditAction.FIAT_DEPOSIT_COMPLETED,
  [AdminFiatDepositAction.RELEASE]: AdminAuditAction.FIAT_DEPOSIT_RELEASED
}

/**
 * Fiat top-ups, as an operator sees and settles them.
 *
 * The list is a list. The two actions are the ones the automatic path
 * deliberately will not take on its own — a top-up whose hold ran out with
 * money already in it, or a payout Transacto ended in a way the reconciler
 * could not read — and both are settled through
 * {@link FiatDepositSettlementService}, the same service the reconciler and the
 * Mini App use. A second implementation here would be a second settlement path
 * for the same money, which is exactly what this panel's rules forbid.
 */
@Injectable()
export class AdminFiatDepositsService {
  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly settlement: FiatDepositSettlementService,
    private readonly usersService: AdminUsersService,
    private readonly auditService: AdminAuditService
  ) {}

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminFiatDepositListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.fiatDepositDb.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.FIAT_DEPOSITS)
    )

    const names = await this.usersService.namesFor(page.items.map((row) => row.telegramId))

    return toPaginatedRes(page, paging, (row) =>
      toAdminFiatDeposit(row, names.get(row.telegramId) ?? String(row.telegramId))
    )
  }

  /**
   * Credits a top-up by hand, or gives its payout back.
   *
   * The status is re-checked here rather than trusted from the client: the row
   * may have moved since it was drawn — the reconciler runs every thirty
   * seconds — and an operator can reach this endpoint without a menu at all.
   */
  async act(
    depositId: string,
    request: AdminFiatDepositActionReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminFiatDepositListItem> {
    const deposit = await this.fiatDepositDb.findById(depositId)
    if (deposit === null) throw new NotFoundException(ERROR.FIAT_DEPOSIT.NOT_FOUND)

    const settled = await this.settle(request.action, deposit)

    // `null` means the row moved under the operator — the reconciler completed
    // it, or the panel would not take the payout back. Either way nothing
    // happened, and an audit line saying otherwise would be a false record.
    if (settled === null) throw new ConflictException(ERROR.ADMIN.ORDER_NOT_ACTIONABLE)

    await this.auditService.record({
      actor: admin.username,
      action: ACTION_AUDIT[request.action],
      targetType: AdminAuditTargetType.FIAT_DEPOSIT,
      targetId: depositId,
      reason: request.reason,
      metadata: {
        payoutId: deposit.payoutId,
        telegramId: deposit.telegramId,
        statusBefore: deposit.status,
        amountUah: deposit.amountUah,
        // What the payout had actually taken when the decision was made. The
        // question every review of one of these starts with is "how much of it
        // had landed?", and the row itself will have moved on by then.
        coveredUah: deposit.coveredUah,
        cryptoCents: deposit.cryptoCents
      },
      ip
    })

    const username = await this.usersService.namesFor([settled.telegramId])

    return toAdminFiatDeposit(settled, username.get(settled.telegramId) ?? String(settled.telegramId))
  }

  private async settle(
    action: AdminFiatDepositAction,
    deposit: TmaFiatDepositRecord
  ): Promise<TmaFiatDepositRecord | null> {
    if (action === AdminFiatDepositAction.COMPLETE) return this.settlement.complete(deposit)

    return this.settlement.release(deposit, TmaFiatDepositStatus.EXPIRED)
  }

  /**
   * Matched against the payout id, the recipient card and the payer's id.
   *
   * The payout id is what an operator carries over from Transacto's own panel,
   * and the card is what a support conversation starts from. Status is not
   * searchable as text: it is an enum, and typing "review" should not
   * half-match a card number.
   */
  private searchFilter(search: string | undefined): QueryFilter<TmaFiatDeposit> {
    if (!search) return {}

    const pattern = new RegExp(escapeRegex(search), 'i')
    const asNumber = Number(search)
    const asStatus = Object.values(TmaFiatDepositStatus).find(
      (status) => status === search.toUpperCase()
    )

    return {
      $or: [
        { recipientCard: pattern },
        ...(asStatus ? [{ status: asStatus }] : []),
        ...(Number.isFinite(asNumber) ? [{ payoutId: asNumber }, { telegramId: asNumber }] : [])
      ]
    }
  }
}
