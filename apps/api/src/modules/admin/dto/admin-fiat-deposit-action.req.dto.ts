import { AdminFiatDepositAction } from '@transacto/contracts'
import type { AdminFiatDepositActionReq } from '@transacto/contracts'
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** Crediting a fiat top-up by hand, or giving its payout back. */
export class AdminFiatDepositActionReqDto implements AdminFiatDepositActionReq {
  @IsEnum(AdminFiatDepositAction)
  readonly action: AdminFiatDepositAction

  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
