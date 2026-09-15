import { IsInt, Min } from 'class-validator'
import { KOPECKS_PER_UAH, type CreateFiatDepositReq } from '@transacto/contracts'

/**
 * The amount a user picked off the offer, in UAH kopecks.
 *
 * Validated as a whole number rather than a member of the offered list: the
 * list is a live snapshot of somebody else's book, and a DTO that tried to
 * enumerate it would be stale before the request finished. Whether this amount
 * is actually on offer is settled by trying to reserve one.
 */
export class CreateFiatDepositReqDto implements CreateFiatDepositReq {
  /** UAH kopecks, e.g. `170600` for ₴1 706. */
  @IsInt()
  @Min(KOPECKS_PER_UAH)
  readonly amountUah: number
}
