import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { TmaDepositStatus } from '@transacto/contracts'

export type TmaDepositDocument = HydratedDocument<TmaDeposit>

// Status travels to the Mini App, so it is owned by @transacto/contracts.
export { TmaDepositStatus }

/**
 * The two endings that mean the money arrived and was credited.
 *
 * `PAID_LATE` is a `COMPLETED` whose hash turned up after the window closed —
 * the balance moved either way, per the approved policy — so every question of
 * the form "has this user ever actually paid us" has to ask for both. Named
 * once because three queries ask it, and a fourth written from memory would
 * quietly leave the late payers out.
 */
export const CREDITED_DEPOSIT_STATUSES: readonly TmaDepositStatus[] = [
  TmaDepositStatus.COMPLETED,
  TmaDepositStatus.PAID_LATE
]

@Schema({ timestamps: true, collection: 'tma_deposits', versionKey: false })
export class TmaDeposit {
  @Prop({ type: Number, required: true, index: true })
  telegramId: number

  /** Expected crypto amount in human-readable units (e.g., 10.50 USDT) */
  @Prop({ type: Number, required: true })
  cryptoAmount: number

  /** Equivalent fiat value in UAH kopecks at time of creation */
  @Prop({ type: Number, required: true })
  fiatEquivalent: number

  /** Exchange rate snapshot: 1 USDT = X UAH (in kopecks) at creation time */
  @Prop({ type: Number, required: true })
  exchangeRate: number

  @Prop({ type: String, enum: TmaDepositStatus, default: TmaDepositStatus.PENDING })
  status: TmaDepositStatus

  /**
   * Blockchain transaction hash, once one has been verified against this
   * deposit. `null` until then.
   *
   * Uniqueness is enforced by the partial index declared below, not here — see
   * there for why `unique: true` on this prop was the reason a user could only
   * ever have one unpaid deposit.
   */
  @Prop({ type: String, default: null })
  txId: string | null

  @Prop({ type: Date, required: true })
  expiresAt: Date

  @Prop({ type: Date, default: null })
  verifiedAt: Date | null

  /**
   * What this USDT was worth in hryvnia when it was credited — the buy rate at
   * that moment, in kopecks per USDT. `null` on deposits credited before this
   * was recorded, and on every deposit that never was.
   *
   * **Internal, and deliberately so.** It reaches no client and no contract: a
   * user who brought their own USDT did not buy it here, and showing them our
   * valuation of it would be quoting a price for a trade that never happened.
   * It exists so that the history of a balance can be read back in hryvnia
   * afterwards — by an operator, by a report, by whoever has to explain a
   * number a year from now.
   *
   * Separate from {@link exchangeRate}, which is the rate quoted when the
   * deposit was *created* — what the user was shown before they sent anything.
   * The two differ whenever a deposit is paid slowly, and `PAID_LATE` exists
   * precisely because that happens; overwriting the quote with the settlement
   * would lose the figure the user was actually shown.
   */
  @Prop({ type: Number, default: null })
  creditedExchangeRate: number | null

  /**
   * Hryvnia kopecks the credited USDT was worth at {@link creditedExchangeRate}.
   *
   * Computed from what was **actually credited**, not from
   * {@link cryptoAmount}: a transfer larger than the declared one is accepted
   * and credited in full, so the declared figure would understate it.
   */
  @Prop({ type: Number, default: null })
  creditedFiatEquivalent: number | null

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const TmaDepositSchema = SchemaFactory.createForClass(TmaDeposit)

/**
 * A transaction hash may be claimed by one deposit only — that is what stops
 * the same payment being credited twice.
 *
 * Partial, not sparse, and the difference is the whole bug. A sparse index
 * skips documents where the field is *missing*, but `default: null` writes an
 * explicit `null` on every new deposit — and sparse indexes explicit nulls. So
 * the second unpaid deposit collided with the first on `txId: null`, and since
 * the index is global it did so across all users: one pending deposit existed
 * in the entire system at a time, and everybody else got a duplicate-key error.
 *
 * Filtering on `$type: 'string'` indexes only deposits that actually have a
 * hash, which is the rule that was meant all along.
 */
TmaDepositSchema.index(
  { txId: 1 },
  { unique: true, partialFilterExpression: { txId: { $type: 'string' } } }
)
