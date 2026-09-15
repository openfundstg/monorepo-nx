import { AdminBalanceOperation, AdminBalanceTarget } from '@transacto/contracts'
import type { AdminAdjustBalanceReq } from '@transacto/contracts'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** A manual correction to one of a user's two balances. */
export class AdminAdjustBalanceReqDto implements AdminAdjustBalanceReq {
  @IsEnum(AdminBalanceOperation)
  readonly operation: AdminBalanceOperation

  @IsEnum(AdminBalanceTarget)
  readonly target: AdminBalanceTarget

  /**
   * USDT cents, always positive — {@link operation} carries the direction.
   *
   * `Min(1)` and not `Min(0)`: a correction of zero moves no money and writes
   * an audit row saying somebody thought about it, which is noise in the one
   * log that has to stay readable.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly amountCents: number

  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
