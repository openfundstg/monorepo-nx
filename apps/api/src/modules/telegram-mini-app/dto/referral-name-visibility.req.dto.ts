import { IsBoolean } from 'class-validator'
import type { ReferralNameVisibilityReq } from '@transacto/contracts'

export class ReferralNameVisibilityReqDto implements ReferralNameVisibilityReq {
  @IsBoolean()
  readonly showNameToReferrer: boolean
}
