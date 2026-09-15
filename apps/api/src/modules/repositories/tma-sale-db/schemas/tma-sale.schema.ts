import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import {
  BankProvider,
  TmaSaleStatus,
  SaleEventType,
  SaleBlockReason,
  SaleRemainderPolicy
} from '@transacto/contracts'

export type TmaSaleDocument = HydratedDocument<TmaSale>

// Status travels to the Mini App, so it is owned by @transacto/contracts.
export {
  TmaSaleStatus,
  SaleEventType,
  SaleBlockReason,
  SaleRemainderPolicy
}

/**
 * One step of the order's execution, persisted so a reconnecting client and a
 * cold page load see the same timeline the live stream produced.
 *
 * Stored as a key plus its parameters — never a rendered sentence, since the
 * Mini App renders it in the user's language.
 */
@Schema({ _id: false, versionKey: false })
export class TmaSaleEvent {
  @Prop({ type: String, enum: SaleEventType, required: true })
  type: SaleEventType

  /** UAH kopecks, on money events only. */
  @Prop({ type: Number, default: null })
  amount: number | null

  /** Transacto's numeric order id, when the event concerns a specific order. */
  @Prop({ type: Number, default: null })
  orderId: number | null

  /** Epoch milliseconds. */
  @Prop({ type: Number, required: true })
  at: number
}

export const TmaSaleEventSchema = SchemaFactory.createForClass(TmaSaleEvent)

@Schema({ timestamps: true, collection: 'tma_sales', versionKey: false })
export class TmaSale {
  /**
   * Human-readable identifier shown to the user and embedded in the terminal
   * name (`TMA-<publicId>`). Unique across every sale, not per user, so
   * a code quoted to support resolves to exactly one order.
   */
  @Prop({ type: String, required: true, unique: true, index: true })
  publicId: string

  @Prop({ type: Number, required: true, index: true })
  telegramId: number

  /** Fiat amount to sell, in UAH kopecks */
  @Prop({ type: Number, required: true })
  fiatAmount: number

  /**
   * The rate this sale was priced at — UAH kopecks per USDT, snapshotted when
   * it was created.
   *
   * **The finished sell rate**: the market's part and the markup are already
   * inside it, and neither is recorded. It is what the user was quoted, what
   * their stake was taken at, and what every settlement here converts with — so
   * a sale is priced once, and nothing that happens to it afterwards can
   * reprice it.
   *
   * It used to hold the *market* rate, with `profitPercent` and
   * `expectedProfit` beside it, and every reader had to remember to combine the
   * first two. Most did. The partial settlement did not, and charged users the
   * hryvnia they had actually received at the market rate rather than at the
   * rate they sold it at — about 2% of every partial fill, in the user's
   * disfavour, silently. Migration `0003` converted the stored figures and
   * removed the other two fields.
   */
  @Prop({ type: Number, required: true })
  exchangeRate: number

  /** USDT **cents** frozen for this specific order. */
  @Prop({ type: Number, required: true })
  frozenUsdt: number

  /**
   * Which bank the drop is with.
   *
   * The enum comes from `BankProvider` rather than a list of strings. The list
   * was written out here and went stale the day a fourth bank was added: every
   * other per-bank map in the codebase is a `Record<BankProvider, …>` that the
   * compiler completes, this one was three literals nothing checked, and the
   * first NovaPay order froze a user's stake and then died on Mongoose's
   * validation with the money still frozen.
   */
  @Prop({ type: String, required: true, enum: Object.values(BankProvider) })
  bankType: string

  /** Drop link / jar URL provided by the user */
  @Prop({ type: String, required: true })
  dropLink: string

  @Prop({ type: String, enum: TmaSaleStatus, default: TmaSaleStatus.CREATED })
  status: TmaSaleStatus

  /** Transacto terminal ID linked to this sale (from POST /credentials_create) */
  @Prop({ type: Number, default: null })
  transactoTerminalId: number | null

  /** Local terminal cardId reference */
  @Prop({ type: Number, default: null })
  cardId: number | null

  /**
   * The trader that owns the terminal upstream — the holder of
   * `TMA_SERVICE_TRADER_API_TOKEN`.
   *
   * Stored because every scraper, sync and polling path keys terminals by
   * `{ traderId, cardId }`. Without it the Mini App's terminal was written under
   * `traderId: 0`, matched no scrape, and the order could never observe its own
   * money arriving.
   */
  @Prop({ type: Number, default: null, index: true })
  traderId: number | null

  /** UAH kopecks matched and executed on the terminal so far. */
  @Prop({ type: Number, default: 0 })
  receivedAmount: number

  /**
   * Transacto order ids already counted towards {@link receivedAmount}.
   *
   * Two independent paths can report the same order as settled — the scraper
   * matching a jar delta, and Transacto reporting it paid through the admin
   * panel — and a single order must move the total exactly once whichever
   * arrives first. Held as a set on the document so the check and the increment
   * are one atomic update rather than a read-then-write race.
   */
  @Prop({ type: [Number], default: [] })
  creditedOrderIds: number[]

  /**
   * Last jar balance the scraper reported for this terminal, in UAH kopecks.
   *
   * Persisted rather than read back out of Redis on demand so a cold page load
   * and a live push answer with the same number, and so the Mini App module
   * needs no dependency on the scraper. `null` means "never scraped" — which a
   * client must render as unknown, not as an empty jar.
   */
  @Prop({ type: Number, default: null })
  jarBalance: number | null

  /**
   * The jar's balance the first time this order's terminal was scraped, in UAH
   * kopecks. `null` until that first scrape lands.
   *
   * The baseline a refund is measured from. A user may point an order at a jar
   * that already holds money, and that hryvnia was theirs before any of this
   * started — charging USDT for it on cancellation would take payment for
   * something we never delivered. Seeded once and never rewritten, so it stays
   * the balance *before* this order rather than following the jar up.
   *
   * Written by the first `updateJarBalance`, which runs within seconds of the
   * terminal being created — before Transacto could have created and routed an
   * order to it, so it captures the jar as it was handed to us.
   */
  @Prop({ type: Number, default: null })
  openingJarBalance: number | null

  /**
   * The receiver name sent to Transacto as this terminal's `name`.
   *
   * What a payer is shown as the person they are paying, and what comes back on
   * every order as `receiver_name`. Stored because support is otherwise asked
   * "what name did the payer see?" and has to go and ask Transacto — and
   * because the answer is a judgement made once at creation, from whichever
   * source was available: see `resolveReceiverName`.
   *
   * `null` on orders created before the field existed, which is also every
   * order whose `name` was the old `TMA-<telegramId>`.
   */
  @Prop({ type: String, default: null })
  receiverName: string | null

  /**
   * What to do with a tail no payment can cover.
   *
   * Snapshotted at creation, like {@link exchangeRate}
   * and for the same reason: changing the default later must not change how an
   * order already running settles.
   *
   * The default is {@link SaleRemainderPolicy.WAIT_FOR_TOP_UP}, which is
   * how every order behaved before the choice existed — so orders stored before
   * this field, which `.lean()` returns without Mongoose defaults, must be read
   * as `remainderPolicy ?? WAIT_FOR_TOP_UP`.
   */
  @Prop({
    type: String,
    enum: SaleRemainderPolicy,
    default: SaleRemainderPolicy.WAIT_FOR_TOP_UP
  })
  remainderPolicy: SaleRemainderPolicy

  /**
   * USDT cents handed back as the unfillable tail, on completion.
   *
   * Zero on every order that filled its jar, and on every order that waited for
   * a top-up. Stored rather than derived so the ledger can be reconciled
   * afterwards: `frozenUsdt` is what was taken and this is what came back, and
   * the difference is what the order actually cost.
   */
  @Prop({ type: Number, default: 0 })
  refundedRemainderUsdt: number

  /** The same tail in UAH kopecks, before it was converted at {@link exchangeRate}. */
  @Prop({ type: Number, default: 0 })
  refundedRemainderFiat: number

  /** Execution timeline, oldest first. */
  @Prop({ type: [TmaSaleEventSchema], default: [] })
  events: TmaSaleEvent[]

  @Prop({ type: Date, default: null })
  completedAt: Date | null

  /**
   * Why this order was stopped, when its status is BLOCKED.
   *
   * A key rather than a message — the Mini App renders it in the user's
   * language. `null` for every order that was never blocked.
   */
  /**
   * Whether the bank itself named the card this order pays into, rather than
   * the user typing it.
   *
   * True only for a bank in `BANKS_DISCLOSING_CARD` — PrivatBank today, whose
   * envelope record names its own card. When it is true the account is not a
   * claim we are checking, it is a fact the bank stated, and the dead-order
   * fraud rule is skipped: that rule exists to catch a card that does not
   * belong to the jar, which cannot happen when the jar named the card.
   *
   * Defaults to `false`, so every order written before this field existed keeps
   * the fraud rule. That is the safe direction — an unnecessary check costs a
   * false positive on a jar nobody could pay into anyway, while a skipped one
   * costs the thing the rule was built to catch.
   */
  @Prop({ type: Boolean, default: false })
  cardVerifiedByBank: boolean

  /**
   * When the bank reported this order's jar closed, or `null` while it is open.
   *
   * The jar outlives the order, and that is the problem it records. An order
   * expires on Transacto's clock, but the jar behind it keeps accepting money —
   * a payer who started late can land hryvnia in it five or ten minutes after
   * the order died. Nothing then matches that payment, the payer appeals, and
   * we are out of pocket either way.
   *
   * So the user is asked to close the jar. Until they do, their sale
   * slot stays taken, and for an order they stopped themselves their stake
   * stays frozen. It is the only lever that exists: we cannot close somebody's
   * jar for them.
   *
   * **There is no time limit on either half, and the slot's was removed after
   * being tried.** An hour's grace was added because the rule had locked a
   * NEWBIE out at "4/1 running" with no way to bring the count down — but it
   * treated the symptom. The count came down while the jars stayed open, so the
   * risk this field exists to record simply went unaccounted, and the user was
   * told nothing either way. What makes the rule liveable instead is that the
   * product now names the jars: `slotsAwaitingJarClosure` on the dashboard and
   * on the create form, the card on the sale's own screen, and
   * `AdminSaleAction.RELEASE_JAR` for the case where the bank will not
   * answer at all.
   *
   * Set by the scraper the moment a bank reports the jar closed — PrivatBank's
   * `active: false`, PUMB's non-`ACTIVE` status, Monobank's `closed` — by the
   * reconciliation sweep for a jar nothing is watching, and by an operator
   * through `RELEASE_JAR`, which is the one path where nobody asked a bank.
   */
  @Prop({ type: Date, default: null })
  jarClosedAt: Date | null

  /**
   * When an operator last put this order back into service after a block, or
   * `null` if nobody ever has.
   *
   * It is not a log line: the goal check reads it and stops blocking on a
   * mismatched target once it is set. Resuming used to be undone seventeen
   * seconds later by the same automatic check that raised the block — the
   * button in the panel did nothing anybody could see, because a target that
   * was wrong at the block is still wrong on the next scrape. An operator
   * pressing it *is* the answer to the question the check asks.
   *
   * Narrow on purpose: the dead-order rule keeps working, because that one is
   * about a card that does not belong to the jar and no operator can vouch for
   * a payer walking away three times.
   */
  @Prop({ type: Date, default: null })
  resumedByAdminAt: Date | null

  @Prop({ type: String, enum: SaleBlockReason, default: null })
  blockReason: SaleBlockReason | null

  /**
   * The jar target the bank actually reported when the order was blocked for a
   * mismatch, in UAH kopecks.
   *
   * Kept so the user can be shown both numbers — what their jar says versus
   * what it had to say — without re-scraping a terminal that is by then
   * disabled.
   */
  @Prop({ type: Number, default: null })
  observedGoal: number | null

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const TmaSaleSchema = SchemaFactory.createForClass(TmaSale)

/**
 * The reverse lookup the progress pipeline lives on: a bank scrape knows only
 * `cardId`, and this is the only route back to the owning `telegramId`.
 */
TmaSaleSchema.index({ cardId: 1, status: 1 })
