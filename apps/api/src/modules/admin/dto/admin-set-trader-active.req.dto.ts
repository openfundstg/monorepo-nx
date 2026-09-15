import type { AdminSetTraderActiveReq } from '@transacto/contracts'
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** Activating or deactivating a trader account. */
export class AdminSetTraderActiveReqDto implements AdminSetTraderActiveReq {
  @IsBoolean()
  readonly isActive: boolean

  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
