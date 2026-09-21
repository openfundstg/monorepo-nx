import type { Types } from 'mongoose'
import type {
  AdminDepositKind,
  AdminDocumentKind,
  BankProvider,
  SaleStatementRejection,
  SaleStatementStatus,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus
} from '@transacto/contracts'

/**
 * The shapes the two cross-collection feeds project their sources into.
 *
 * Declared here rather than inferred from the pipelines, because an
 * aggregation's output type is whatever the caller claims it is — the one place
 * in this layer where TypeScript cannot check the shape against the schema. A
 * named type at least makes the claim reviewable, and makes the mapper fail to
 * compile when the projection and the mapper disagree.
 *
 * Dates are `Date`; the ISO conversion happens at the admin module's boundary
 * with every other row's, so the archive and the lists cannot format the same
 * timestamp differently.
 */

/** One deposit, whichever rail it came over. See `AdminDepositFeedDbService`. */
export interface AdminDepositFeedRow {
  readonly _id: Types.ObjectId
  readonly kind: AdminDepositKind
  readonly telegramId: number
  /** USDT cents on both rails — converted in the pipeline, never by a caller. */
  readonly cryptoCents: number
  /** UAH kopecks. */
  readonly fiatAmount: number
  readonly exchangeRate: number
  readonly status: TmaDepositStatus | TmaFiatDepositStatus
  readonly coveredUah: number | null
  readonly documentCount: number
  readonly acceptedDocumentCount: number
  readonly bank: BankProvider | null
  readonly payoutId: number | null
  readonly txId: string | null
  readonly deadlineAt: Date
  readonly completedAt: Date | null
  readonly createdAt: Date
}

/** One archived document. See `AdminDocumentFeedDbService`. */
export interface AdminDocumentFeedRow {
  readonly _id: Types.ObjectId
  readonly kind: AdminDocumentKind
  readonly telegramId: number
  readonly bank: BankProvider | null
  readonly status: SaleStatementStatus | TmaFiatReceiptStatus
  readonly rejection: SaleStatementRejection | TmaFiatReceiptRejection | null
  readonly amountUah: number | null
  readonly sizeBytes: number | null
  /**
   * The file's name in its own archive, or `null` where none was kept.
   *
   * Read by the download route and by nothing else. It never reaches the wire:
   * a stored name is a path, and a path is not an operator's business.
   */
  readonly storedName: string | null
  readonly uploadedAt: Date
  readonly purgedAt: Date | null
  readonly externalUrl: string | null
  readonly saleId: Types.ObjectId | null
  readonly salePublicId: string | null
  readonly cardOrderId: number | null
  readonly fiatDepositId: Types.ObjectId | null
  readonly payoutId: number | null
  readonly periodFrom: Date | null
  readonly periodTo: Date | null
  readonly ownerName: string | null
  readonly recipientChecked: boolean | null
}
