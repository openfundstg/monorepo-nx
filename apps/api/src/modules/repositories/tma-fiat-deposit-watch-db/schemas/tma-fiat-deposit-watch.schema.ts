import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { FiatDepositWatchMode } from '@transacto/contracts'
import { HydratedDocument } from 'mongoose'

export type TmaFiatDepositWatchDocument = HydratedDocument<TmaFiatDepositWatch>

/**
 * One user's standing request to be told when a sum in their range reaches
 * Transacto's book.
 *
 * **`telegramId` is unique, and that is the whole storage design.** The product
 * rule is one request per person — asking again replaces — so it is expressed
 * as an index rather than as a delete-then-insert in a service. A user who taps
 * *subscribe* twice in the same second gets one document either way, without
 * anybody having to have thought about the race.
 *
 * Bounds are UAH kopecks and both are inclusive, matching every other amount in
 * this product; `minAmountUah === maxAmountUah` is a legitimate request for one
 * exact sum.
 *
 * No `telegramId` → user reference and no denormalised username. The panel joins
 * on the id when it draws the list, and a name copied here would be the name
 * the person had on the day they asked.
 */
@Schema({ timestamps: true, collection: 'tma_fiat_deposit_watches', versionKey: false })
export class TmaFiatDepositWatch {
  @Prop({ type: Number, required: true, unique: true, index: true })
  telegramId: number

  /** UAH kopecks. Inclusive. */
  @Prop({ type: Number, required: true })
  minAmountUah: number

  /** UAH kopecks. Inclusive, never below {@link minAmountUah}. */
  @Prop({ type: Number, required: true })
  maxAmountUah: number

  @Prop({ type: String, enum: FiatDepositWatchMode, required: true })
  mode: FiatDepositWatchMode

  /**
   * When this request last produced a message, or `null`.
   *
   * Written only in `ALWAYS` mode — a `ONCE` request is deleted by the message
   * that satisfies it, so no document survives to carry the stamp. It is
   * therefore not a throttle but a record: the panel sorts on it to find the
   * requests nobody has ever been able to answer.
   */
  @Prop({ type: Date, default: null })
  lastNotifiedAt: Date | null

  createdAt: Date

  updatedAt: Date
}

export const TmaFiatDepositWatchSchema = SchemaFactory.createForClass(TmaFiatDepositWatch)

/**
 * The index the announcement pass runs on.
 *
 * Every twenty seconds it asks "whose range contains one of these amounts",
 * which is a range query over both bounds. Leading on `minAmountUah` lets Mongo
 * bound the scan from below and filter the rest, which on a collection of
 * requests is the difference between an index scan and reading every one of
 * them six times a minute forever.
 */
TmaFiatDepositWatchSchema.index({ minAmountUah: 1, maxAmountUah: 1 })
