import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import {
  BankProvider,
  FIAT_DEPOSIT_HELD_STATUSES,
  FIAT_DEPOSIT_PAYABLE_STATUSES,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus
} from '@transacto/contracts'

export type TmaFiatDepositDocument = HydratedDocument<TmaFiatDeposit>

// All three travel to the Mini App and the panel, so they are owned by
// @transacto/contracts and re-exported here for schema-side consumers.
export { TmaFiatDepositStatus, TmaFiatReceiptRejection, TmaFiatReceiptStatus }

/**
 * The query-side names for the two rules that live in `@transacto/contracts`.
 *
 * Aliases, not copies: a `$in` needs an array and the rule needs one home, and
 * the home is the contracts package because the Mini App and the panel apply
 * the same rule to the same statuses.
 */
export const LIVE_FIAT_DEPOSIT_STATUSES = FIAT_DEPOSIT_PAYABLE_STATUSES
export const HELD_FIAT_DEPOSIT_STATUSES = FIAT_DEPOSIT_HELD_STATUSES

@Schema({ versionKey: false })
export class TmaFiatDepositReceipt {
  @Prop({ type: String, enum: TmaFiatReceiptStatus, required: true })
  status: TmaFiatReceiptStatus

  @Prop({ type: String, enum: TmaFiatReceiptRejection, default: null })
  rejection: TmaFiatReceiptRejection | null

  /**
   * The amount Transacto recognised, in UAH kopecks — `null` until it accepts
   * the receipt.
   *
   * Their figure, not one we read off the file: coverage is counted in what the
   * counterparty acknowledged, so a receipt we happened to read differently
   * cannot complete a payout they still consider open.
   */
  @Prop({ type: Number, default: null })
  amountUah: number | null

  /**
   * The recognition job upstream, while one is running.
   *
   * Kept so a restart mid-parse can pick the poll back up instead of leaving a
   * receipt stuck in PARSING with the answer sitting unread at Transacto.
   */
  @Prop({ type: Number, default: null })
  upstreamJobId: number | null

  /**
   * Where Transacto filed the accepted receipt.
   *
   * Read back off their checks table during reconciliation, for an operator to
   * open. A rejected receipt has none, because Transacto files only what it
   * took — which is exactly why {@link storedName} exists: the receipt an
   * operator is asked about a month later is usually the refused one, and it
   * used to have no copy anywhere at all.
   */
  @Prop({ type: String, default: null })
  checkUrl: string | null

  /**
   * Whether the recipient on this receipt was actually compared with the
   * payout's card.
   *
   * `false` on one combination only: a PrivatBank transfer that stayed inside
   * PrivatBank, whose document names the recipient's IBAN rather than a card,
   * against a Transacto payout whose `recipient_name` is empty. Nothing on
   * either side is comparable, so that check does not run and the receipt goes
   * up on the strength of the other three — authentic, right sum, right window.
   *
   * Recorded because it is a weaker claim about somebody's money than the row
   * beside it, and an operator reconciling a disputed top-up should be able to
   * see which of the two it was rather than inferring it from the bank.
   *
   * **Not exposed to the Mini App.** `toFiatDepositContract` lists the fields a
   * user sees and this is not among them; it is an operator's fact.
   */
  @Prop({ type: Boolean, default: true })
  recipientChecked: boolean

  /**
   * Which bank's signature vouched for this receipt, or `null`.
   *
   * `null` on a receipt refused before any bank was reached — one whose code
   * could not be read, or one the verifier could not consult. Recorded because
   * the archive lists both kinds of document side by side and a receipt that
   * names no bank is a receipt nobody proved.
   */
  @Prop({ type: String, enum: BankProvider, default: null })
  bank: BankProvider | null

  /**
   * The file's name on disk, relative to `FIAT_RECEIPT_STORAGE_DIR`, or `null`
   * for a receipt uploaded before this product kept any.
   *
   * Never built from anything the user sent: a name they chose is a path they
   * chose. See `FiatReceiptStorageService`.
   */
  @Prop({ type: String, default: null })
  storedName: string | null

  /** As uploaded. `null` where no file was kept. */
  @Prop({ type: Number, default: null })
  sizeBytes: number | null

  /**
   * When the file itself was deleted, or `null` while it is still on disk.
   *
   * **The record outlives the document**, exactly as it does for a statement:
   * what a top-up was settled on stays, and the bytes — which state a payer's
   * and a recipient's credentials in full — do not.
   */
  @Prop({ type: Date, default: null })
  purgedAt: Date | null

  @Prop({ type: Date, required: true })
  uploadedAt: Date
}

export const TmaFiatDepositReceiptSchema = SchemaFactory.createForClass(TmaFiatDepositReceipt)

@Schema({ timestamps: true, collection: 'tma_fiat_deposits', versionKey: false })
export class TmaFiatDeposit {
  @Prop({ type: Number, required: true, index: true })
  telegramId: number

  /** Transacto's numeric payout id, the row this user is settling. */
  @Prop({ type: Number, required: true, index: true })
  payoutId: number

  /**
   * `telegramId` while this top-up is live, `null` once it is not.
   *
   * A lock, not data — see the unique partial index below. It duplicates
   * {@link telegramId} on purpose: MongoDB cannot enforce "one live row per
   * user" over a status field directly, and the alternative, checking in the
   * service before inserting, is a race that two taps on a phone can win.
   */
  @Prop({ type: Number, default: null })
  activeUserKey: number | null

  /**
   * `payoutId` while we hold that payout, `null` after it is released.
   *
   * Nullable rather than a plain unique index on {@link payoutId}, because a
   * released payout goes back into Transacto's book and may legitimately be
   * offered — and reserved — again later. What must never happen is two live
   * top-ups pointing at the same payout at the same time.
   */
  @Prop({ type: Number, default: null })
  activePayoutId: number | null

  /** The payout's full amount, in UAH kopecks. */
  @Prop({ type: Number, required: true })
  amountUah: number

  /** USDT cents to credit on completion, computed once at reservation. */
  @Prop({ type: Number, required: true })
  cryptoCents: number

  /**
   * Kopecks per 1 USDT, snapshotted when the payout was reserved.
   *
   * Frozen because the user was shown a figure before they moved their own
   * money; re-pricing at credit time would settle them at a rate they never
   * agreed to.
   */
  @Prop({ type: Number, required: true })
  exchangeRate: number

  /** The recipient card as Transacto states it, digits only. Never logged. */
  @Prop({ type: String, required: true })
  recipientCard: string

  @Prop({
    type: String,
    enum: TmaFiatDepositStatus,
    default: TmaFiatDepositStatus.RESERVED,
    index: true
  })
  status: TmaFiatDepositStatus

  @Prop({ type: [TmaFiatDepositReceiptSchema], default: [] })
  receipts: TmaFiatDepositReceipt[]

  /**
   * Accepted receipts so far, in UAH kopecks.
   *
   * Denormalised from {@link receipts} so a progress bar and the completion
   * check do not each re-derive it — and so the figure the user watched is
   * still readable after an operator edits the row.
   */
  @Prop({ type: Number, default: 0 })
  coveredUah: number

  /** When the on-screen timer runs out. The user is told this one. */
  @Prop({ type: Date, required: true })
  payDeadlineAt: Date

  /**
   * When we stop holding the payout — later than {@link payDeadlineAt} on
   * purpose.
   *
   * Somebody who pays at the last second still has to open their bank, save the
   * receipt and upload it. Releasing on the visible deadline would hand the
   * payout to another trader while their money was already on its way to it.
   */
  @Prop({ type: Date, required: true, index: true })
  holdUntilAt: Date


  /** When Transacto reported the payout executed and the USDT was credited. */
  @Prop({ type: Date, default: null })
  completedAt: Date | null

  /** When the payout was handed back to Transacto's book. */
  @Prop({ type: Date, default: null })
  releasedAt: Date | null

  createdAt: Date

  updatedAt: Date
}

export const TmaFiatDepositSchema = SchemaFactory.createForClass(TmaFiatDeposit)

/**
 * One live top-up per user.
 *
 * Enforced here rather than by a count in the service because the check and the
 * insert cannot be one operation there: two taps arriving together both read
 * "none active" and both reserve, which puts two strangers' payouts on one
 * person's card and leaves the next receipt matchable to either.
 *
 * Partial on `$type: 'number'` for the reason `tma_deposits.txId` is — an
 * explicit `null` is a value MongoDB indexes like any other, so a bare or
 * merely sparse unique index would make every *closed* top-up collide with
 * every other.
 */
TmaFiatDepositSchema.index(
  { activeUserKey: 1 },
  { unique: true, partialFilterExpression: { activeUserKey: { $type: 'number' } } }
)

/** And one live top-up per payout, for the same reason and in the same shape. */
TmaFiatDepositSchema.index(
  { activePayoutId: 1 },
  { unique: true, partialFilterExpression: { activePayoutId: { $type: 'number' } } }
)
