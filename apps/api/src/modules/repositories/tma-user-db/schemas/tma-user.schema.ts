import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type TmaUserDocument = HydratedDocument<TmaUser>

@Schema({ timestamps: true, collection: 'tma_users', versionKey: false })
export class TmaUser {
  @Prop({ type: Number, unique: true, required: true, index: true })
  telegramId: number

  @Prop({ type: String, default: '' })
  firstName: string

  @Prop({ type: String, default: '' })
  lastName: string

  @Prop({ type: String, default: '' })
  username: string

  /**
   * Spendable balance in **USDT cents** — not kopecks, whatever this comment
   * used to say. Every mutation on it takes `amountCents` (`creditBalance`,
   * `freezeBalance`, `unfreezeBalance`), the dashboard renders it through the
   * `usdt` pipe, and `frozenBalance` below has already been taken out of it.
   */
  @Prop({ type: Number, default: 0 })
  balance: number

  /** User's frozen balance in cents (USDT) for active sales */
  @Prop({ type: Number, default: 0 })
  frozenBalance: number

  /** Lifetime total sold amount in UAH kopecks */
  @Prop({ type: Number, default: 0 })
  totalTurnover: number

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  /**
   * A promoter's account: `/auth` hands the Mini App a generated history to
   * show instead of this document's figures, and every write the account sends
   * is refused.
   *
   * Nothing about the demo is stored — not here, not anywhere. This flag is
   * the whole of it, and switching it off leaves the account exactly as it was.
   *
   * Absent on every document written before it existed, and a lean read
   * applies no default, so it is read as `=== true` and never as truthy.
   */
  @Prop({ type: Boolean, default: false })
  isDemo: boolean

  /**
   * This user's own referral code — the `startapp` payload of the link they
   * share. Same eight-character format as a sale's public id.
   *
   * Uniqueness is enforced by the partial index declared below rather than
   * `unique: true` here; see there for why. Codes are backfilled lazily on the
   * owner's next authentication rather than by a migration script, because the
   * collection predates the referral programme.
   */
  @Prop({ type: String, default: null })
  referralCode: string | null

  /**
   * Telegram id of whoever invited this user, or `null`.
   *
   * Written exactly once and never changed — a referral relationship that could
   * be re-pointed would let earnings be reassigned after the fact.
   */
  @Prop({ type: Number, default: null, index: true })
  referredBy: number | null

  /**
   * Referral earnings in USDT **cents**, held apart from {@link balance}.
   *
   * Deliberately a second pot rather than a credit into the main balance: the
   * product rule is that this money can only ever be moved across to the
   * spendable balance, so keeping it in its own field makes "cannot fund a
   * sale" a property of the data instead of a check every caller has to
   * remember.
   */
  @Prop({ type: Number, default: 0 })
  referralBalance: number

  /** Lifetime referral earnings in USDT cents — never decremented by transfers. */
  @Prop({ type: Number, default: 0 })
  totalReferralEarned: number

  /**
   * Opt-in: show this user's name to whoever invited them.
   *
   * Defaults to off, so joining through someone's link never discloses identity
   * by itself. The referrer sees a stable masked id in place of the name.
   */
  @Prop({ type: Boolean, default: false })
  showNameToReferrer: boolean

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const TmaUserSchema = SchemaFactory.createForClass(TmaUser)

/**
 * Referral codes are unique **among users who have one**.
 *
 * Partial, not sparse, and the distinction is the difference between working
 * and locking the collection: a sparse index skips documents where the field is
 * *missing*, but `default: null` above means an unset code is written as an
 * explicit `null` — which sparse still indexes. The second user created without
 * a code would then collide with the first. Filtering on `$type: 'string'`
 * excludes both nulls and missing fields, so only real codes are compared.
 */
TmaUserSchema.index(
  { referralCode: 1 },
  { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } }
)
