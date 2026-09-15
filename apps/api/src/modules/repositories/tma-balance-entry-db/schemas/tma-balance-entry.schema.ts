import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'
import { BalanceEntryKind } from '@transacto/contracts'

export type TmaBalanceEntryDocument = HydratedDocument<TmaBalanceEntry>

// The kinds travel to the Mini App on the balance timeline, so they are owned
// by @transacto/contracts and re-exported here for schema-side consumers.
export { BalanceEntryKind }

/**
 * The kinds the user's own timeline renders from this book.
 *
 * Everything else it moves is already on that timeline as the process it
 * belongs to — a deposit, a top-up, a sale — and would arrive a second
 * time as arithmetic. These two have no process document anywhere: a referral
 * transfer and an operator's correction were, until this collection existed,
 * money appearing on a balance with nothing on any screen to explain it.
 */
export const USER_VISIBLE_BALANCE_KINDS: readonly BalanceEntryKind[] = [
  BalanceEntryKind.REFERRAL_TRANSFER,
  BalanceEntryKind.ADMIN_ADJUSTMENT
]

/**
 * The kinds that put USDT on a balance that was not already there.
 *
 * **`SALE_REFUND` is deliberately absent**, and the sign is why it had
 * to be named rather than filtered on. A refund is booked positive — it is the
 * unfrozen half of a stake coming back — but it is the *same* USDT returning
 * from reserve, not USDT arriving. Reading arrivals as "amount above zero"
 * counted every part-filled order's remainder as a fresh, costless lot, which
 * on an income page reads as free money the user never received.
 *
 * `OPENING_BALANCE` is here for the opposite reason: it really is USDT that
 * arrived, on a day nothing was recording how. What it cost is unknowable, and
 * a reader of these kinds has to treat it that way.
 */
export const BALANCE_ACQUISITION_KINDS: readonly BalanceEntryKind[] = [
  BalanceEntryKind.DEPOSIT,
  BalanceEntryKind.FIAT_DEPOSIT,
  BalanceEntryKind.REFERRAL_TRANSFER,
  BalanceEntryKind.ADMIN_ADJUSTMENT,
  BalanceEntryKind.OPENING_BALANCE
]

/**
 * One movement of one user's spendable balance.
 *
 * Append-only: nothing here is ever updated or deleted. A correction is another
 * entry, which is the difference between a book and a cache — the row records
 * what was true at a moment, and the moment does not change afterwards.
 *
 * Written *after* the balance moves, never before, and never in a way that can
 * fail the movement — see `BalanceLedgerService`. There are no transactions
 * between the two writes, so one of them has to be able to lose: a movement
 * with no entry is a hole in the explanation, an entry with no movement is a
 * lie about somebody's money, and only the first is recoverable by reading the
 * source document it points at.
 */
@Schema({ timestamps: true, collection: 'tma_balance_entries', versionKey: false })
export class TmaBalanceEntry {
  @Prop({ type: Number, required: true, index: true })
  telegramId: number

  @Prop({ type: String, enum: BalanceEntryKind, required: true })
  kind: BalanceEntryKind

  /**
   * USDT cents, **signed**: what the balance gained (`+`) or lost (`-`).
   *
   * Signed rather than an absolute paired with a direction flag, because the
   * one question this collection exists to answer is a sum — and a sum over
   * `amountCents` is the whole reconciliation.
   */
  @Prop({ type: Number, required: true })
  amountCents: number

  /**
   * The balance this movement left behind, in USDT cents — or `null` when it is
   * not knowable.
   *
   * Denormalised on purpose. It is what makes a single row auditable without
   * replaying every row before it, and it is the only way to notice that the
   * book and the user document have drifted — which, with two non-atomic
   * writes, is a thing that can happen.
   *
   * `null` only on rows a migration reconstructed from documents written before
   * the book existed. What a user's balance stood at after a deposit two months
   * ago is not recorded anywhere, and inventing it by replaying an incomplete
   * history would put a precise-looking number on a guess. See
   * {@link backfilledBy}, which is set on exactly those rows.
   */
  @Prop({ type: Number, default: null })
  balanceAfter: number | null

  /**
   * The document this movement came from — a deposit, a top-up, a sale
   * — or `null` when it came from an action rather than a document.
   *
   * For linking, not for uniqueness; {@link dedupeKey} does that job, and the
   * two are separate because not every movement with a source happens once.
   */
  @Prop({ type: Types.ObjectId, default: null })
  sourceId: Types.ObjectId | null

  /**
   * A caller-supplied name for "this exact movement", or `null` for movements
   * that may legitimately repeat.
   *
   * The unique index below is what makes a booking idempotent: a reconciler
   * that credits the same deposit twice — or a retried request — writes one
   * entry, not two. Callers pass one only where the movement is once-and-only-
   * once by nature (`deposit:<id>`, `stake:<orderId>`); a refund, a transfer
   * and an operator's correction pass none, because a user may genuinely
   * receive two of any of them.
   */
  @Prop({ type: String, default: null })
  dedupeKey: string | null

  /**
   * The migration that reconstructed this row, or `null` for the rows the
   * product wrote as the money actually moved.
   *
   * Provenance, and it earns its place twice: it is what tells a reader that a
   * row is a reconstruction rather than an observation, and it is what a
   * migration's `down` deletes by — nothing else can say which rows a backfill
   * put there.
   */
  @Prop({ type: String, default: null })
  backfilledBy: string | null

  /** Written by `timestamps: true`, declared so the lean type carries it. */
  createdAt: Date

  updatedAt: Date
}

export const TmaBalanceEntrySchema = SchemaFactory.createForClass(TmaBalanceEntry)

/**
 * The timeline read: one user's entries, newest first.
 *
 * Compound rather than an index on `telegramId` alone, because every read of
 * this collection is that query — and without the sort key in the index Mongo
 * sorts a user's whole history in memory to return the ten rows a screen shows.
 */
TmaBalanceEntrySchema.index({ telegramId: 1, createdAt: -1 })

/**
 * Idempotency, for the movements that claim it.
 *
 * Partial on `$type: 'string'` and not sparse, for exactly the reason the
 * deposit's `txId` index is — `default: null` writes an explicit `null` on
 * every entry that does not book a once-only movement, and a sparse index
 * indexes explicit nulls: the second refund in the system would collide with
 * the first, across all users.
 */
TmaBalanceEntrySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
)
