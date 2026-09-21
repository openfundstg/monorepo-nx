import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminDepositKind,
  AdminFiatDepositAction,
  ERROR,
  TmaFiatDepositStatus,
  type AdminDepositRowItem,
  type AdminFiatDepositActionReq
} from '@transacto/contracts'
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import { FiatDepositSettlementService } from 'src/modules/telegram-mini-app/services/fiat-deposit-settlement.service'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import { AdminDepositsService } from 'src/modules/admin/services/admin-deposits.service'

/** Which audit action each intervention writes. */
const ACTION_AUDIT: Readonly<Record<AdminFiatDepositAction, AdminAuditAction>> = {
  [AdminFiatDepositAction.COMPLETE]: AdminAuditAction.FIAT_DEPOSIT_COMPLETED,
  [AdminFiatDepositAction.RELEASE]: AdminAuditAction.FIAT_DEPOSIT_RELEASED
}

/**
 * The two interventions an operator can make on a fiat top-up.
 *
 * **Reading them is not this service's job any more** — the deposits book shows
 * both rails through `AdminDepositsService`, and a second listing here would be
 * a second projection of the same row. What is left is the pair of writes, and
 * they are the ones the automatic path deliberately will not take on its own:
 * a top-up whose hold ran out with money already in it, or a payout Transacto
 * ended in a way the reconciler could not read. Both are settled through
 * {@link FiatDepositSettlementService}, the same service the reconciler and the
 * Mini App use. A second implementation here would be a second settlement path
 * for the same money, which is exactly what this panel's rules forbid.
 */
@Injectable()
export class AdminFiatDepositsService {
  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly settlement: FiatDepositSettlementService,
    private readonly deposits: AdminDepositsService,
    private readonly auditService: AdminAuditService
  ) {}

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
  ): Promise<AdminDepositRowItem> {
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

    // Re-read through the book rather than mapped here. The list, the live
    // push and this answer are then one projection of one deposit — which is
    // what stops an operator's own action being the thing that makes their
    // screen disagree with the next refresh.
    const row = await this.deposits.row(AdminDepositKind.FIAT, settled._id.toString())
    if (row === null) throw new NotFoundException(ERROR.FIAT_DEPOSIT.NOT_FOUND)

    return row
  }

  private async settle(
    action: AdminFiatDepositAction,
    deposit: TmaFiatDepositRecord
  ): Promise<TmaFiatDepositRecord | null> {
    if (action === AdminFiatDepositAction.COMPLETE) return this.settlement.complete(deposit)

    return this.settlement.release(deposit, TmaFiatDepositStatus.EXPIRED)
  }
}
