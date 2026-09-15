import { IsEnum, IsInt, Max, Min } from 'class-validator'
import {
  FiatDepositWatchMode,
  KOPECKS_PER_UAH,
  type SaveFiatDepositWatchReq
} from '@transacto/contracts'

/**
 * The largest range worth accepting, in UAH kopecks — ₴10 000 000.
 *
 * Not a product rule and not a ceiling on anybody: it is the bound that keeps a
 * hand-made request from storing a number the panel could never produce and the
 * screen could never render. The real limit on what a user may top up with is
 * the first-deposit ceiling, and it is enforced in the service where it can say
 * so in a code the client translates.
 */
const MAX_WATCH_AMOUNT_KOPECKS = 1_000_000_000

/**
 * A user's standing request to be told when a sum appears.
 *
 * Only the shape is validated here. That `maxAmountUah` is not below
 * `minAmountUah`, that the range is not entirely beneath the product's own
 * floor, and that it is not above this account's ceiling are all rules rather
 * than shapes — they belong in the service, which can answer each with an
 * `ERROR` code the Mini App renders as a sentence instead of a validator's
 * English.
 */
export class SaveFiatDepositWatchReqDto implements SaveFiatDepositWatchReq {
  /** UAH kopecks. Inclusive. */
  @IsInt()
  @Min(KOPECKS_PER_UAH)
  @Max(MAX_WATCH_AMOUNT_KOPECKS)
  readonly minAmountUah: number

  /** UAH kopecks. Inclusive. */
  @IsInt()
  @Min(KOPECKS_PER_UAH)
  @Max(MAX_WATCH_AMOUNT_KOPECKS)
  readonly maxAmountUah: number

  @IsEnum(FiatDepositWatchMode)
  readonly mode: FiatDepositWatchMode
}
