import type { AdminSetUserDemoReq } from '@transacto/contracts'
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** Turning a promoter's account into a demo account, or back. */
export class AdminSetUserDemoReqDto implements AdminSetUserDemoReq {
  @IsBoolean()
  readonly isDemo: boolean

  /**
   * Required, not optional.
   *
   * It goes on the audit row and nowhere else, and it is the only record of
   * who the account was switched over for — a demo account looks, from the
   * outside, like a real one with a very good month.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
