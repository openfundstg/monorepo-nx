import { IsInt, Min } from 'class-validator'
import type { TransferReferralReq } from '@transacto/contracts'

export class TransferReferralReqDto implements TransferReferralReq {
  /** USDT cents. Integer only — there is no smaller unit to round into. */
  @IsInt()
  @Min(1)
  readonly amount: number
}
