import { Injectable } from '@nestjs/common'
import {
  AdminAuditAction,
  AdminAuditTargetType,
  BalanceEntryKind,
  TerminalHistoryAlertType
} from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import { AdminAuditLogDbService } from 'src/modules/repositories/admin-db/services'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import type { Migration } from 'src/migrations/interfaces'

/**
 * What a renamed member used to be called.
 *
 * Every member the rename touched went `SCROLL_ORDER_X` → `SALE_X` with no
 * exceptions, so the old name is recoverable from the new one — and deriving it
 * is safer than a second hand-written list, because a list has to be kept in
 * step with an enum and this cannot fall behind one.
 *
 * It is applied only to members named here, never to whatever a document
 * happens to hold. That distinction is the whole reason this is a function over
 * enum members rather than a `replace` over stored values: the first touches
 * exactly the names somebody checked, the second touches everything.
 */
const legacyName = (member: string): string => member.replace(/^SALE/, 'SCROLL_ORDER')

/** The balance book's two kinds — the only ones the rename touched. */
const BALANCE_KINDS = [BalanceEntryKind.SALE_STAKE, BalanceEntryKind.SALE_REFUND] as const

const AUDIT_ACTIONS = [
  AdminAuditAction.SALE_CANCELLED,
  AdminAuditAction.SALE_BLOCKED,
  AdminAuditAction.SALE_COMPLETED,
  AdminAuditAction.SALE_RESUMED,
  AdminAuditAction.SALE_RELEASED,
  AdminAuditAction.SALE_JAR_RELEASED
] as const

/**
 * Carries the data across the rename of "scroll order" to "sale".
 *
 * The product called this a scroll order for its whole life, and the word
 * reached the user — which is why it is gone. Code and screens changed in one
 * commit; the database cannot, because six of those names are *values* sitting
 * in documents and one is the collection itself, and the new code recognises
 * none of them.
 *
 * **This must run before the new build serves traffic.** It is not a tidy-up.
 * Until it does, `tma_sales` holds nothing, so every sale in the system is
 * invisible: a user's history is empty, the reconciler finds nothing to settle,
 * and the earnings page reports that nobody has ever sold anything. The
 * documents are all still there under the old name; nothing is lost and nothing
 * is found. Worse, a user who creates a sale in that window writes it to the new
 * collection, and the two then have to be merged by hand —
 * {@link TmaSaleDbService.adoptLegacyCollection} refuses rather than guessing,
 * which is the failure being loud instead of silent.
 *
 * Six moves, ordered so that a run which dies partway leaves something
 * readable rather than something half-renamed:
 *
 * 1. **The collection**, first, because it decides whether the app can see
 *    anything at all.
 * 2. **`scrollOrderId` on referral payouts**, second, because it is the one with
 *    money behind it: `record` dedupes a referrer's payout by that field, and a
 *    payout whose key the guard cannot see is a payout that can be made twice.
 *    The unique index moves with it — see the repository method for why that is
 *    not optional.
 * 3. **The balance book's kinds**, which a user reads on their own timeline.
 * 4. **The audit log's actions** and **5. its target types**, two columns of the
 *    same collection, both rendered by concatenating the stored value onto a
 *    translation key.
 * 6. **The terminal history's alerts**, for the same reason.
 *
 * Idempotent throughout, and by filter rather than by catching errors: every
 * step matches on the old value, which the step itself removes. A second run
 * finds nothing and says so.
 *
 * **No `down`.** It could be written — every move here is symmetrical — and it
 * would be a trap: reversing the data without reverting the code leaves a
 * database the running build cannot read, which is the exact failure this
 * migration exists to prevent. Going back means deploying the old build and
 * renaming by hand, deliberately.
 */
@Injectable()
export class RenameScrollOrdersToSalesMigration implements Migration {
  readonly name = '0004-rename-scroll-orders-to-sales'

  constructor(
    private readonly saleDb: TmaSaleDbService,
    private readonly balanceEntryDb: TmaBalanceEntryDbService,
    private readonly referralDb: TmaReferralDbService,
    private readonly auditDb: AdminAuditLogDbService,
    private readonly terminalHistoryDb: TerminalHistoryDbService
  ) {}

  async up(): Promise<string> {
    const collectionMoved = await this.saleDb.adoptLegacyCollection()
    const referrals = await this.referralDb.renameLegacySaleIdField()

    const entries = await this.sum(BALANCE_KINDS, (kind) =>
      this.balanceEntryDb.renameKind(legacyName(kind), kind)
    )

    const actions = await this.sum(AUDIT_ACTIONS, (action) =>
      this.auditDb.renameEnumValue('action', legacyName(action), action)
    )

    const targets = await this.auditDb.renameEnumValue(
      'targetType',
      legacyName(AdminAuditTargetType.SALE),
      AdminAuditTargetType.SALE
    )

    const alerts = await this.terminalHistoryDb.renameAlertType(
      legacyName(TerminalHistoryAlertType.SALE_COMPLETED),
      TerminalHistoryAlertType.SALE_COMPLETED
    )

    return (
      `Renamed scroll orders to sales: collection ${collectionMoved ? 'moved' : 'already moved'}, ` +
      `${referrals} referral payout(s), ${entries} balance entr(ies), ` +
      `${actions} audit action(s), ${targets} audit target(s), ${alerts} terminal alert(s)`
    )
  }

  /** Runs one rename per member and adds up what each moved. */
  private async sum<T>(members: readonly T[], rename: (member: T) => Promise<number>): Promise<number> {
    let moved = 0
    for (const member of members) moved += await rename(member)

    return moved
  }
}
