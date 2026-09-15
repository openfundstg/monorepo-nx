import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { TerminalSource } from '@transacto/contracts'

export { TerminalSource }

export type TerminalDocument = HydratedDocument<Terminal>

@Schema({ timestamps: true, collection: 'terminals', versionKey: false })
export class Terminal {
  @Prop({ type: Number, required: true })
  traderId: number

  @Prop({ type: Number, required: true })
  cardId: number

  @Prop({ type: Number })
  terminalId: number

  @Prop({ type: String, default: 'Unknown' })
  terminalName: string

  /** Monobank Terminal URL (e.g. https://send.monobank.ua/jar/...) */
  @Prop({ type: String, default: null })
  cred3: string | null

  @Prop({ type: Boolean, default: true })
  enabled: boolean

  /**
   * Who created this terminal.
   *
   * Both kinds are created through the Transacto API, so the upstream data does
   * not distinguish them — `TerminalsSyncService` classifies by the Mini App's
   * name prefix on every sync, which also backfills terminals that predate this
   * field.
   *
   * Read it as `source ?? TerminalSource.TRANSACTO`: the DB services use
   * `.lean()`, which does not apply Mongoose defaults to documents already
   * stored without the field.
   */
  @Prop({ type: String, enum: TerminalSource, default: TerminalSource.TRANSACTO })
  source: TerminalSource

  /**
   * Whether Transacto still routes new payers here.
   *
   * Separate from `enabled`, and the case that separates them is a sale
   * winding down: the user asked to stop while orders were still outstanding,
   * so the credential is told `enable_orders: 0` while `enabled` stays `1` on
   * both sides. The terminal keeps being scraped, keeps matching payments and
   * keeps its Redis state — it just gets nobody new.
   *
   * Dropping the scrape at that moment is what the whole arrangement avoids: a
   * payer already holding an order can still pay, and a jar nobody is watching
   * takes that hryvnia silently. The sale would then refund the entire
   * stake while the user kept the money — paying for it twice.
   *
   * Defaults to `true`, so every terminal stored before this field existed
   * reads as routing normally, which is what it was doing.
   */
  @Prop({ type: Boolean, default: true })
  acceptingOrders: boolean

  /**
   * The last balance we observed, in kopecks — display only.
   *
   * The live figure lives in Redis under `terminal:state:current:{id}`, which
   * carries a one-hour TTL and, more importantly, is **deleted outright when a
   * terminal is deactivated** (see `terminalRedisKeys`). So a jar that has been
   * switched off has no balance anywhere, and the extension had nothing to show
   * for it — which is exactly how it was reported: "balances only appear once
   * the scraper starts".
   *
   * This is the durable copy. It is written by `ScraperExecutionService` when
   * the scraped figure actually moves, and nothing ever clears it.
   *
   * **Never read this in the money path.** It is not the baseline: the baseline
   * is the fraud detector's reference point and is cleared on deactivation on
   * purpose, so that a terminal brought back to life does not compare today's
   * balance against a figure from before it went away and read an emptied jar
   * as a withdrawal. Reviving that number here through the back door would
   * reintroduce exactly that bug.
   */
  @Prop({ type: Number, default: null })
  lastBalance: number | null

  /** The last jar target we observed, in kopecks. Display only, as above. */
  @Prop({ type: Number, default: null })
  lastGoal: number | null

  /**
   * When {@link lastBalance} was observed.
   *
   * Shown next to the figure on a disabled terminal. A stale balance presented
   * without its age is worse than none — it reads as current.
   */
  @Prop({ type: Date, default: null })
  lastBalanceAt: Date | null

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. `TerminalsSyncService` reads it to tell a terminal that was deleted
   * upstream from one that was created after it took its upstream snapshot —
   * the two are indistinguishable by card id alone.
   */
  createdAt: Date

  updatedAt: Date
}

export const TerminalSchema = SchemaFactory.createForClass(Terminal)

TerminalSchema.index({ traderId: 1, cardId: 1 }, { unique: true })

// The extension's terminal search filters by trader first and then matches on
// the name, including disabled terminals — which the dashboard query never
// touches, so nothing else covers this.
TerminalSchema.index({ traderId: 1, terminalName: 1 })
