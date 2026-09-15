import type { Types } from 'mongoose'
import type { FiatDepositWatchMode } from '@transacto/contracts'
import type { TmaFiatDepositWatch } from 'src/modules/repositories/tma-fiat-deposit-watch-db/schemas'

/** A request as it comes back from a lean query. */
export type TmaFiatDepositWatchRecord = TmaFiatDepositWatch & { _id: Types.ObjectId }

/** Everything a user chooses when they ask to be told about a sum. */
export interface SaveTmaFiatDepositWatchData {
  readonly minAmountUah: number
  readonly maxAmountUah: number
  readonly mode: FiatDepositWatchMode
}
