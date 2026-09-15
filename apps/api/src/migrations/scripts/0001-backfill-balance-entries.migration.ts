import { Injectable, Logger } from '@nestjs/common'
import {
  AdminAuditAction,
  AdminBalanceOperation,
  AdminBalanceTarget,
  BalanceEntryKind,
  TmaFiatDepositStatus
} from '@transacto/contracts'
import { AdminAuditLogDbService } from 'src/modules/repositories/admin-db/services'
import { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { CREDITED_DEPOSIT_STATUSES } from 'src/modules/repositories/tma-deposit-db/schemas'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'
import type { Migration } from 'src/migrations/interfaces'

/** Rows per read. Big enough to be few round trips, small enough to hold. */
const PAGE_SIZE = 500

/**
 * `_id` ascending, which is stable under concurrent inserts.
 *
 * Skip-based paging over a sort that new documents can land in the middle of
 * would step over rows. ObjectIds only ever increase, so an insert during the
 * walk appends to the end and shifts nothing already read.
 */
const BY_ID: PageQuery['sort'] = { _id: 1 }

/** USDT cents per whole USDT — deposits store the human figure. */
const CENTS_PER_USDT = 100

/**
 * Fills `tma_balance_entries` with the history that happened before it existed.
 *
 * The book is the explanation of a user's balance, and it started empty on the
 * day it shipped: every user's figure was the result of movements nothing had
 * recorded. This reconstructs what the other collections still know, and books
 * the rest as one balance brought forward.
 *
 * What is recoverable, and from where:
 *
 * | Movement | Source | Exact? |
 * | --- | --- | --- |
 * | Crypto deposit credited | `tma_deposits`, COMPLETED and PAID_LATE | yes |
 * | Hryvnia top-up credited | `tma_fiat_deposits`, COMPLETED | yes |
 * | Sale stake | `tma_sales.frozenUsdt` | yes |
 * | Unfillable tail refunded | `tma_sales.refundedRemainderUsdt` | yes |
 * | Operator's correction | `admin_audit_logs`, `USER_BALANCE_ADJUSTED` | yes, with the balance it left |
 * | Refund on a cancelled order | — | no: never written to the order |
 * | Referral transfer | — | no: it was a bare `$inc` and left no trace |
 *
 * The last two are why the balancing line exists. Once everything recoverable
 * is booked, each user's remaining difference — their balance less what the
 * book now explains — goes in as a single `OPENING_BALANCE`, dated at the
 * account's creation. From that moment the invariant holds for everybody: the
 * sum of a user's entries is their balance.
 *
 * **Two properties make re-running safe.** Every row carries a dedupe key, so a
 * second pass writes nothing it wrote before; and nothing is reconstructed at
 * or after the moment the product wrote its first entry, so a movement the app
 * booked live is never booked again from the document behind it.
 *
 * Run it with the API stopped where you can. Nothing breaks if you do not — the
 * cutoff and the dedupe keys hold either way — but a balance that moves between
 * the reconstruction and the balancing line leaves that one user out by the
 * amount that moved, and the fix is another `down` and `up`.
 */
@Injectable()
export class BackfillBalanceEntriesMigration implements Migration {
  readonly name = '0001-backfill-balance-entries'

  private readonly logger = new Logger(BackfillBalanceEntriesMigration.name)

  constructor(
    private readonly entries: TmaBalanceEntryDbService,
    private readonly deposits: TmaDepositDbService,
    private readonly fiatDeposits: TmaFiatDepositDbService,
    private readonly sales: TmaSaleDbService,
    private readonly users: TmaUserDbService,
    private readonly audit: AdminAuditLogDbService
  ) {}

  async up(): Promise<string> {
    // Everything the product itself has booked is off limits. `null` means it
    // has booked nothing yet, so all of history is ours to reconstruct.
    const cutoff = (await this.entries.findFirstLiveAt()) ?? new Date()
    this.logger.log(`Reconstructing movements from before ${cutoff.toISOString()}`)

    const booked = {
      deposits: await this.backfillDeposits(cutoff),
      fiatDeposits: await this.backfillFiatDeposits(cutoff),
      stakes: 0,
      refunds: 0,
      corrections: await this.backfillCorrections(cutoff),
      opening: 0
    }

    const orders = await this.backfillSales(cutoff)
    booked.stakes = orders.stakes
    booked.refunds = orders.refunds

    // Last, and only last: it is the difference between the balance and
    // everything above, so it cannot be computed until everything above is in.
    booked.opening = await this.bookOpeningBalances()

    return (
      `${booked.deposits} deposits, ${booked.fiatDeposits} top-ups, ${booked.stakes} stakes, ` +
      `${booked.refunds} refunds, ${booked.corrections} corrections, ` +
      `${booked.opening} opening balances`
    )
  }

  /**
   * Removes every row this migration wrote, and nothing else.
   *
   * Possible only because reconstructed rows carry the migration's name — the
   * live ones beside them do not, and no dedupe key or date range could tell
   * the two apart afterwards.
   */
  async down(): Promise<string> {
    const removed = await this.entries.deleteBackfilledBy(this.name)

    return `removed ${removed} reconstructed entries`
  }

  private async backfillDeposits(cutoff: Date): Promise<number> {
    let booked = 0

    await this.eachPage(
      (page) =>
        this.deposits.findPage({ status: { $in: [...CREDITED_DEPOSIT_STATUSES] } }, page),
      async (deposit) => {
        // The moment the money landed, not the moment the deposit was created:
        // a PAID_LATE deposit was credited days after it was asked for.
        const at = deposit.verifiedAt ?? deposit.createdAt
        if (at >= cutoff) return

        booked += await this.book({
          telegramId: deposit.telegramId,
          kind: BalanceEntryKind.DEPOSIT,
          amountCents: Math.round(deposit.cryptoAmount * CENTS_PER_USDT),
          sourceId: deposit._id.toString(),
          createdAt: at
        })
      }
    )

    return booked
  }

  private async backfillFiatDeposits(cutoff: Date): Promise<number> {
    let booked = 0

    await this.eachPage(
      (page) => this.fiatDeposits.findPage({ status: TmaFiatDepositStatus.COMPLETED }, page),
      async (fiat) => {
        const at = fiat.completedAt ?? fiat.createdAt
        if (at >= cutoff) return

        booked += await this.book({
          telegramId: fiat.telegramId,
          kind: BalanceEntryKind.FIAT_DEPOSIT,
          // The figure frozen at reservation, which is what was credited — not
          // what the hryvnia would buy today.
          amountCents: fiat.cryptoCents,
          sourceId: fiat._id.toString(),
          createdAt: at
        })
      }
    )

    return booked
  }

  /**
   * Both halves of a sale's effect on the spendable balance.
   *
   * The stake every order took, and the tail the ones that refunded gave back.
   * What an order *spent* is not here and does not belong here: committing a
   * stake moves the frozen pot, which this book does not account for.
   *
   * The refund on a **cancelled** order is missing for a duller reason — it was
   * computed and paid but never written to the document, so there is nothing to
   * read. The balancing line absorbs it.
   */
  private async backfillSales(cutoff: Date): Promise<{ stakes: number; refunds: number }> {
    let stakes = 0
    let refunds = 0

    await this.eachPage(
      (page) => this.sales.findPage({}, page),
      async (order) => {
        if (order.createdAt < cutoff)
          stakes += await this.book({
            telegramId: order.telegramId,
            kind: BalanceEntryKind.SALE_STAKE,
            amountCents: -order.frozenUsdt,
            sourceId: order._id.toString(),
            createdAt: order.createdAt
          })

        const refundedAt = order.completedAt ?? order.createdAt
        if (order.refundedRemainderUsdt > 0 && refundedAt < cutoff)
          refunds += await this.book({
            telegramId: order.telegramId,
            kind: BalanceEntryKind.SALE_REFUND,
            amountCents: order.refundedRemainderUsdt,
            sourceId: order._id.toString(),
            createdAt: refundedAt
          })
      }
    )

    return { stakes, refunds }
  }

  /**
   * Operators' corrections, read back out of their own audit trail.
   *
   * The one reconstruction that recovers the balance it produced as well as the
   * amount: the audit row records `before` and `after`, because it was written
   * to explain itself to a person. Corrections to the referral pot are skipped
   * — that pot is not what this book counts.
   */
  private async backfillCorrections(cutoff: Date): Promise<number> {
    let booked = 0

    await this.eachPage(
      (page) => this.audit.findPage({ action: AdminAuditAction.USER_BALANCE_ADJUSTED }, page),
      async (row) => {
        if (row.createdAt >= cutoff) return

        const metadata = (row.metadata ?? {}) as {
          target?: AdminBalanceTarget
          operation?: AdminBalanceOperation
          amountCents?: number
          after?: number
        }

        if (metadata.target !== AdminBalanceTarget.BALANCE) return
        if (typeof metadata.amountCents !== 'number') return

        const telegramId = Number(row.targetId)
        if (!Number.isFinite(telegramId)) return

        booked += await this.book({
          telegramId,
          kind: BalanceEntryKind.ADMIN_ADJUSTMENT,
          amountCents:
            metadata.operation === AdminBalanceOperation.DEBIT
              ? -metadata.amountCents
              : metadata.amountCents,
          balanceAfter: typeof metadata.after === 'number' ? metadata.after : null,
          sourceId: row._id.toString(),
          createdAt: row.createdAt
        })
      }
    )

    return booked
  }

  /**
   * One line per user for everything the reconstruction cannot name.
   *
   * Read per user and written immediately, rather than computed for everybody
   * and applied at the end: the shorter that gap, the smaller the chance a live
   * movement lands inside it and leaves that user out by its amount.
   *
   * A user whose difference is zero gets nothing — most accounts that never
   * transferred referral money and never cancelled an order land exactly.
   */
  private async bookOpeningBalances(): Promise<number> {
    let booked = 0

    await this.eachPage(
      (page) => this.users.findPage({}, page),
      async (user) => {
        const explained = await this.entries.sumForUser(user.telegramId)
        const remainder = user.balance - explained
        if (remainder === 0) return

        booked += await this.book({
          telegramId: user.telegramId,
          kind: BalanceEntryKind.OPENING_BALANCE,
          amountCents: remainder,
          // Dated at the account, so it sits under everything else: it is what
          // the balance was brought forward with, not something that happened.
          createdAt: user.createdAt
        })
      }
    )

    return booked
  }

  /**
   * Writes one reconstructed row, and reports whether it was new.
   *
   * The dedupe key is the same shape the live path builds — kind and source —
   * so a re-run adds nothing, and a movement the product later books for the
   * same document collides with this rather than joining it.
   */
  private async book(entry: {
    telegramId: number
    kind: BalanceEntryKind
    amountCents: number
    balanceAfter?: number | null
    sourceId?: string
    createdAt: Date
  }): Promise<number> {
    const written = await this.entries.backfill({
      ...entry,
      sourceId: entry.sourceId ?? null,
      dedupeKey: `${entry.kind}:${entry.sourceId ?? entry.telegramId}`,
      backfilledBy: this.name
    })

    return written === null ? 0 : 1
  }

  /**
   * Walks a paginated read to the end, one row at a time.
   *
   * The repositories all page — the admin panel needs them to — so a migration
   * needs no cursor of its own and no Mongoose of its own. The cost is a
   * `countDocuments` per page, which for a one-off run is nothing.
   */
  private async eachPage<T>(
    read: (page: PageQuery) => Promise<Page<T>>,
    handle: (item: T) => Promise<void>
  ): Promise<void> {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const { items } = await read({ skip, limit: PAGE_SIZE, sort: BY_ID })
      if (items.length === 0) return

      for (const item of items) await handle(item)
      if (items.length < PAGE_SIZE) return
    }
  }
}
