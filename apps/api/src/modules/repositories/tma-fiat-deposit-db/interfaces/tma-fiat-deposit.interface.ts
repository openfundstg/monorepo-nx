import type { Types } from 'mongoose'
import type {
  TmaFiatDeposit,
  TmaFiatDepositReceipt
} from 'src/modules/repositories/tma-fiat-deposit-db/schemas'

/** A receipt as it comes back from a lean query — with the `_id` Mongo gave it. */
export type TmaFiatDepositReceiptRecord = TmaFiatDepositReceipt & { _id: Types.ObjectId }

/**
 * A top-up as it comes back from a lean query.
 *
 * Spelled out rather than left as `TmaFiatDeposit & { _id: any }` because the
 * receipt ids are the handles every later write uses — one upload is confirmed,
 * rejected or reconciled by its own `_id`, and an `any` there would let a
 * string be passed where an ObjectId belongs and fail at the database instead
 * of the compiler.
 */
export type TmaFiatDepositRecord = Omit<TmaFiatDeposit, 'receipts'> & {
  _id: Types.ObjectId
  receipts: TmaFiatDepositReceiptRecord[]
}

/** Everything a reservation fixes at the moment the payout becomes this user's. */
export interface CreateTmaFiatDepositData {
  readonly telegramId: number
  readonly payoutId: number
  readonly amountUah: number
  readonly cryptoCents: number
  readonly exchangeRate: number
  readonly recipientCard: string
  readonly payDeadlineAt: Date
  readonly holdUntilAt: Date
}
