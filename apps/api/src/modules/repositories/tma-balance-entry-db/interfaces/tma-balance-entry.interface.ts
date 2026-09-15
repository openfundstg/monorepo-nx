import type { Types } from 'mongoose'
import type { TmaBalanceEntry } from 'src/modules/repositories/tma-balance-entry-db/schemas'

/** A stored entry, as every read of this collection returns it. */
export type TmaBalanceEntryRecord = TmaBalanceEntry & { _id: Types.ObjectId }

/**
 * What booking a movement needs.
 *
 * `balanceAfter` is not among the caller's choices — it is read off the write
 * that moved the money, so the entry cannot claim a balance nobody had.
 */
export interface CreateTmaBalanceEntryData {
  telegramId: number
  kind: TmaBalanceEntry['kind']
  amountCents: number
  balanceAfter: number
  sourceId?: Types.ObjectId | string | null
  dedupeKey?: string | null
}

/**
 * What reconstructing a movement needs.
 *
 * Two fields the live path does not have and must never gain: the moment it
 * happened, which is being restored from a document rather than observed now,
 * and the migration doing the restoring. `balanceAfter` is optional here for
 * the same reason — it is knowable for a movement the audit log recorded in
 * full, and not for one inferred from a deposit.
 */
export interface BackfillTmaBalanceEntryData
  extends Omit<CreateTmaBalanceEntryData, 'balanceAfter'> {
  balanceAfter?: number | null
  /** When it actually happened. */
  createdAt: Date
  /** The migration's own name, so `down` can find its work again. */
  backfilledBy: string
}
