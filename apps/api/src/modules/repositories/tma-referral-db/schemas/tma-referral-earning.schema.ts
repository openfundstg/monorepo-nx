import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type TmaReferralEarningDocument = HydratedDocument<TmaReferralEarning>

/**
 * One referral payout: a completed sale, the person who sold it,
 * and the cut their referrer received for it.
 *
 * A ledger rather than a running counter on the user. Two reasons: the
 * per-referral figures the page shows are an aggregate of these rows, so they
 * cannot drift from the balance they explain; and money that only exists as an
 * `$inc` has no audit trail — nothing can answer "which orders make up this
 * 12.40 USDT" after the fact.
 *
 * Every amount is stored as it was computed, including the rate and the source
 * order's fiat total, because both are snapshots: changing
 * `REFERRAL_RATE_PERCENT` or the exchange rate must never retroactively restate
 * a payout that already happened.
 */
@Schema({ timestamps: true, collection: 'tma_referral_earnings', versionKey: false })
export class TmaReferralEarning {
  /** Who was paid. */
  @Prop({ type: Number, required: true, index: true })
  referrerTelegramId: number

  /** Whose sale paid them. */
  @Prop({ type: Number, required: true, index: true })
  referredTelegramId: number

  /**
   * The order this cut came from.
   *
   * Unique, and that uniqueness is load-bearing: it is the second, independent
   * guarantee that one sale pays its referrer exactly once. The status
   * guard in `completeIfOpen` already prevents a double completion, but a
   * duplicate here fails at the database rather than silently paying twice.
   */
  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true })
  saleId: Types.ObjectId

  /** The cut, in USDT **cents** — the unit it lands on the balance in. */
  @Prop({ type: Number, required: true })
  amount: number

  /** The source order's total, in UAH kopecks. */
  @Prop({ type: Number, required: true })
  fiatAmount: number

  /** UAH kopecks per USDT, snapshotted from the order. */
  @Prop({ type: Number, required: true })
  exchangeRate: number

  /** The percentage applied, snapshotted at payout time (e.g. `0.1`). */
  @Prop({ type: Number, required: true })
  ratePercent: number

  /**
   * Written by `timestamps`, declared here so it is visible on the lean type —
   * the admin panel sorts on it.
   */
  createdAt: Date
}

export const TmaReferralEarningSchema = SchemaFactory.createForClass(TmaReferralEarning)

/** The page's per-referral breakdown groups on exactly this pair. */
TmaReferralEarningSchema.index({ referrerTelegramId: 1, referredTelegramId: 1 })
