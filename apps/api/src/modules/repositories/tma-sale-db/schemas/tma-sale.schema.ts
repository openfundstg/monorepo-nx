import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'
import {
  BankProvider,
  TmaSaleStatus,
  SaleEventType,
  SaleEvidence,
  SaleBlockReason,
  SaleRemainderPolicy,
  SaleMethod,
  SaleCardOrderState,
  SaleReceiverNameSource,
  SaleStatementStatus,
  SaleStatementRejection
} from '@transacto/contracts'

export type TmaSaleDocument = HydratedDocument<TmaSale>

// Status travels to the Mini App, so it is owned by @transacto/contracts.
export {
  TmaSaleStatus,
  SaleEventType,
  SaleBlockReason,
  SaleRemainderPolicy,
  SaleMethod,
  SaleCardOrderState,
  SaleReceiverNameSource,
  SaleStatementStatus,
  SaleStatementRejection
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
  /**
   * Mongo's own, declared so it is visible on the lean type.
   *
   * Every entry already had one — an array of subdocuments gets them unless the
   * schema says otherwise — and nothing named it, so the panel had nothing
   * stable to track a row by.
   */
  _id: Types.ObjectId

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

  /**
   * Who says so — see {@link SaleEvidence}.
   *
   * Absent on every event written before this existed, which is honest: nobody
   * recorded whose word those stood on, and defaulting them to one answer would
   * invent a fact. `toAdminSaleHistory` reads a missing value as unknown rather
   * than as a claim.
   */
  @Prop({ type: String, enum: SaleEvidence, default: null })
  evidence: SaleEvidence | null

  /** The statement this event is about, on the statement events. */
  @Prop({ type: Types.ObjectId, default: null })
  statementId: Types.ObjectId | null

  /**
   * The statement that later vouched for this entry.
   *
   * **Written long after the entry was.** An accepted statement covers a
   * period, and everything the seller asserted inside it stops being their word
   * and becomes a matter of record — so accepting one reaches back over this
   * sale's earlier claims and stamps them. That retroactive write is the point:
   * until it existed, a claim nobody had corroborated and one a bank had
   * confirmed looked identical.
   */
  @Prop({ type: Types.ObjectId, default: null })
  corroboratedByStatementId: Types.ObjectId | null

  @Prop({ type: Date, default: null })
  corroboratedAt: Date | null
}

export const TmaSaleEventSchema = SchemaFactory.createForClass(TmaSaleEvent)

/**
 * One bank statement uploaded to settle one disputed order.
 *
 * **The bytes are not here.** They are written to disk under this document's
 * own `_id`, and nothing but an operator's download ever reads them back. A
 * statement is the most sensitive document this product handles — somebody's
 * whole transaction history — so what the database keeps is the verdict and the
 * few fields the verdict was reached on, and the file stays a file.
 */
@Schema({ versionKey: false })
export class TmaSaleStatement {
  /**
   * Mongo's own, declared so it is visible on the lean type.
   *
   * Load-bearing rather than incidental: it names the file on disk, and it is
   * how an operator asks for one particular statement.
   */
  _id: Types.ObjectId

  /** Which bank's verifier judged it, and whose format it was read with. */
  @Prop({ type: String, enum: BankProvider, required: true })
  bank: BankProvider

  @Prop({ type: String, enum: SaleStatementStatus, default: SaleStatementStatus.UPLOADED })
  status: SaleStatementStatus

  /** Why it proved nothing, or `null` while it still might. */
  @Prop({ type: String, enum: SaleStatementRejection, default: null })
  rejection: SaleStatementRejection | null

  /**
   * The file's name on disk, relative to `SALE_STATEMENT_STORAGE_DIR`.
   *
   * Stored rather than derived from `_id`, so the layout on disk can change
   * without orphaning every statement written under the old one. Never built
   * from anything the user sent: a name they chose is a path they chose.
   */
  @Prop({ type: String, required: true })
  storedName: string

  @Prop({ type: Number, required: true })
  sizeBytes: number

  /**
   * When the file itself was deleted, or `null` while it is still on disk.
   *
   * **The record outlives the document, deliberately.** What a dispute was
   * settled on — the verdict, the period, the account holder — is the audit
   * trail and stays forever; the bytes are somebody's whole transaction
   * history and have no business doing the same. This is what tells the two
   * apart, and what lets an operator see that a statement existed and is gone
   * rather than that it never existed.
   *
   * `storedName` is left alone so the row still says what the file was called,
   * which is what makes an orphan on disk traceable.
   */
  @Prop({ type: Date, default: null })
  purgedAt: Date | null

  @Prop({ type: Date, default: () => new Date() })
  uploadedAt: Date

  /**
   * The period the document covers, once it has been read.
   *
   * The pair that decides whether it is evidence at all. A statement proves a
   * *negative* — that no such credit arrived — and one whose period does not
   * contain the whole time the order was open proves nothing about the part it
   * misses. Both `null` until the document has been parsed, and a `null` here
   * can never be read as "covers everything".
   */
  @Prop({ type: Date, default: null })
  periodFrom: Date | null

  @Prop({ type: Date, default: null })
  periodTo: Date | null

  /**
   * The account holder's name as the document states it.
   *
   * What rewrites the sale's `receiverName` on the first accepted statement:
   * the bank naming its own customer outranks a form field. Kept per statement
   * rather than only on the sale, because a later statement naming somebody
   * else is a fact worth having both halves of.
   */
  @Prop({ type: String, default: null })
  ownerName: string | null

  /**
   * The last four digits of the account the document is for.
   *
   * Four and not more, for the reason `cardTail` gives: enough to refuse a
   * statement plainly for another account, and not a payment credential at rest.
   */
  @Prop({ type: String, default: null })
  accountTail: string | null
}

export const TmaSaleStatementSchema = SchemaFactory.createForClass(TmaSaleStatement)

/**
 * One Transacto order of a card sale — the unit the seller has to answer.
 *
 * A jar sale's orders live only in the `orders` collection and in the timeline,
 * because nobody is asked anything about them: the scraper sees the money or it
 * does not. These are questions put to a person, so each carries its own clock,
 * its own answer and whatever was uploaded to settle it.
 */
@Schema({ _id: false, versionKey: false })
export class TmaSaleCardOrder {
  /** Transacto's internal numeric id — the only one `orders_execute` accepts. */
  @Prop({ type: Number, required: true })
  orderId: number

  /** What the payer was routed to send, in UAH kopecks. */
  @Prop({ type: Number, required: true })
  amount: number

  @Prop({
    type: String,
    enum: SaleCardOrderState,
    default: SaleCardOrderState.AWAITING_CONFIRMATION
  })
  state: SaleCardOrderState

  @Prop({ type: Date, default: () => new Date() })
  arrivedAt: Date

  /**
   * When silence becomes a dispute.
   *
   * **Ours, not Transacto's.** Their `deadline` is how long the payer has to
   * pay; this is how long the seller has to say whether the money came. Stored
   * per order rather than computed from `arrivedAt` plus a constant, so
   * changing the window later cannot move the deadline of an order already
   * counting down — the same reason `exchangeRate` is snapshotted.
   */
  @Prop({ type: Date, required: true })
  confirmDeadlineAt: Date

  /** When it was answered, or `null` while it still stands open. */
  @Prop({ type: Date, default: null })
  answeredAt: Date | null

  /**
   * What the seller says actually landed, in UAH kopecks.
   *
   * Absent when they answered with a plain "it arrived", which means the whole
   * of {@link amount}. Present and smaller when a transfer fee took a bite out
   * of it, and it is then this figure — not `amount` — that counts toward the
   * sale's target.
   *
   * Kept even after a statement corrects the total, because the two are
   * different facts: what the seller said, and what the bank shows. Overwriting
   * the claim with the truth would erase the only record that they differed.
   */
  @Prop({ type: Number, required: false })
  declaredAmount?: number

  /** Statements uploaded against this order, oldest first. */
  @Prop({ type: [TmaSaleStatementSchema], default: [] })
  statements: TmaSaleStatement[]
}

export const TmaSaleCardOrderSchema = SchemaFactory.createForClass(TmaSaleCardOrder)

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

  /**
   * Where this sale delivers its hryvnia — and therefore what proves it did.
   *
   * The one field that decides which half of this document is meaningful.
   * A {@link SaleMethod.JAR} sale uses `dropLink`, `jarBalance`,
   * `openingJarBalance`, `jarClosedAt` and `observedGoal`, and none of them mean
   * anything on a {@link SaleMethod.CARD} sale, which uses `cardOrders` and
   * `payoutCardTail` instead. Rather than two collections for two shapes that
   * share a stake, a rate, a status machine and a timeline, they share one and
   * this says which is which.
   *
   * Defaults to `JAR` because that is what every sale written before the
   * variant existed was. `.lean()` does not apply defaults, so the backfill
   * migration writes it onto those documents explicitly — a reader that has to
   * remember `?? JAR` is a reader that will one day forget.
   */
  @Prop({ type: String, enum: SaleMethod, default: SaleMethod.JAR, index: true })
  saleMethod: SaleMethod

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
  /**
   * The jar this sale pays into, already resolved to the link the scraper can
   * read.
   *
   * **Empty on a card sale**, which has no jar — hence a default rather than
   * `required`, since Mongoose reads an empty string as a missing required
   * field. Emptiness here is not "unknown": it is the destination being
   * somewhere else, and `saleMethod` is what says where.
   */
  @Prop({ type: String, default: '' })
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
   * How much {@link receiverName} has been proven.
   *
   * `DECLARED` on every sale at creation: a jar's owner name and a card
   * seller's typed one are both assembled from what was available, and neither
   * has been checked against the account the money lands on. The first accepted
   * statement moves it to `STATEMENT`, which only a card sale can produce.
   *
   * Recorded rather than inferred because the rewrite is the interesting part:
   * a statement naming somebody other than who the seller typed means money has
   * already gone to a card whose holder they described wrongly, and that is a
   * question for an operator rather than a field update.
   */
  @Prop({
    type: String,
    enum: SaleReceiverNameSource,
    default: SaleReceiverNameSource.DECLARED
  })
  receiverNameSource: SaleReceiverNameSource

  /**
   * The last four digits of the card a card sale pays out to.
   *
   * Four and not sixteen — see `cardTail`. Nothing in this codebase stores a
   * full PAN: the card goes to Transacto as `cred` and is never written down,
   * which is why `terminals` keeps `cred3` and no `cred`. Four digits are
   * enough to recognise the payout account on a bank statement and to name it
   * on screen, which is everything this field is asked to do.
   *
   * `null` on a jar sale, whose destination is the drop link.
   */
  @Prop({ type: String, default: null })
  payoutCardTail: string | null

  /**
   * How far a bank statement has established the truth for this sale.
   *
   * The period end of the last statement accepted against it. **Every card
   * order answered on or before this moment is settled fact**, whatever the
   * seller said at the time: the document has been read, the credits counted,
   * and any difference already applied.
   *
   * `null` while no statement has ever been accepted, which is the ordinary
   * case — most sales never need one.
   *
   * It exists because a shortfall is the one claim on this document a seller
   * gains by making. Saying ₴995 arrived of ₴1 000 leaves ₴5 outstanding, so
   * another order is routed and they receive more hryvnia for the same stake.
   * The statement is what turns that claim into a fact or into a correction —
   * and this is how the sale remembers which of its claims have been through
   * that and which have not.
   */
  @Prop({ type: Date, default: null })
  statementCheckpointAt: Date | null

  /**
   * The Transacto orders of a card sale, oldest first.
   *
   * At most `SALE_CARD_MAX_ORDERS`, and at most one awaiting an answer at a
   * time — the credential is created with `max_open_orders: 1`, so the cap is
   * upstream's to enforce and this is where the answers are kept.
   *
   * Empty on a jar sale. Bounded by seven, which is what makes an embedded
   * array the right shape here rather than a collection of its own.
   */
  @Prop({ type: [TmaSaleCardOrderSchema], default: [] })
  cardOrders: TmaSaleCardOrder[]

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
   * When this sale first had less left to collect than the pipeline will route.
   *
   * The moment a sale enters its tail, and a one-way gate. Written rather than
   * derived even though `saleTailKopecks` recomputes the same fact on demand,
   * because three things have to happen exactly once and none of them can be
   * decided from the figures alone: routing is stood down upstream, an operator
   * is told what to transfer, and the clock starts on how long the seller is
   * asked to wait for it.
   *
   * `null` on every sale that has not reached its tail — which includes every
   * sale that filled its target outright, since being funded is checked first
   * and closes the sale before the gap can ever be one.
   *
   * Monotone by construction: `receivedAmount` only rises and `fiatAmount` never
   * moves, so a tail once reached is only ever left by being filled. Nothing
   * clears this.
   */
  @Prop({ type: Date, default: null })
  tailReachedAt: Date | null

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

/**
 * How an operator finds a card sale from the only thing they have.
 *
 * A dispute is worked in Transacto's own panel, where the order is a number and
 * nothing else — no sale id, no user, no public code. This index is what turns
 * that number back into the sale, the seller and the statement they uploaded.
 * Without it the lookup is a collection scan, which is the same as not having
 * the feature at three in the morning.
 */
TmaSaleSchema.index({ 'cardOrders.orderId': 1 })

/** Sweeping card orders whose confirmation window has run out. */
TmaSaleSchema.index({ saleMethod: 1, 'cardOrders.state': 1, 'cardOrders.confirmDeadlineAt': 1 })

/**
 * A sale as it comes back from Mongo — the schema plus the id Mongo gave it.
 *
 * Nine services had written this line for themselves, which is nine places to
 * change the day a lean read stops looking like this, and nine chances for one
 * of them to be missed. It lives beside the schema because that is what it is
 * made of.
 */
export type StoredSale = TmaSale & { _id: Types.ObjectId }
