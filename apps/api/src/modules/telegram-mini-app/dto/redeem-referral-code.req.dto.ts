import { Matches } from 'class-validator'
import { Transform } from 'class-transformer'
import { REFERRAL_CODE_PATTERN } from '@transacto/contracts'
import type { RedeemReferralCodeReq } from '@transacto/contracts'

export class RedeemReferralCodeReqDto implements RedeemReferralCodeReq {
  /**
   * Normalised before validation because this is the one code a human types by
   * hand — from a message, off a screen — so trailing spaces and lower case are
   * the expected input, not an error worth a 400.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(REFERRAL_CODE_PATTERN)
  readonly code: string
}
