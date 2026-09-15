import type { AdminAlertActionReq } from '@transacto/contracts'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/**
 * Resolving or deleting an alert.
 *
 * The reason carries more weight on a delete than anywhere else in the panel:
 * the alert row is destroyed, and the audit entry holding this text is the only
 * record that it ever existed.
 */
export class AdminAlertActionReqDto implements AdminAlertActionReq {
  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
