import type { AdminSetUserActiveReq } from '@transacto/contracts'
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** Blocking or unblocking one Mini App user. */
export class AdminSetUserActiveReqDto implements AdminSetUserActiveReq {
  @IsBoolean()
  readonly isActive: boolean

  /**
   * Required, not optional.
   *
   * It goes on the audit row and nowhere else — the user is never shown it —
   * so the only cost of demanding it is a moment of the operator's time, and
   * the thing it buys is an account lock that can be explained a month later.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
