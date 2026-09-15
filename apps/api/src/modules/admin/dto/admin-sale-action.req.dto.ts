import { AdminSaleAction } from '@transacto/contracts'
import type { AdminSaleActionReq } from '@transacto/contracts'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/** Cancelling, blocking or completing a running sale by hand. */
export class AdminSaleActionReqDto implements AdminSaleActionReq {
  @IsEnum(AdminSaleAction)
  readonly action: AdminSaleAction

  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string

  /**
   * USDT cents to refund, overriding the computed figure.
   *
   * Optional, and absent means "use the number the product would have used".
   * `Min(0)` and not `Min(1)`: refunding nothing is a legitimate outcome — an
   * order whose jar already took the whole stake — and refusing zero would make
   * that case impossible to express.
   *
   * The upper bound is the order's own stake, which is not a constant and so is
   * checked in the service against the order being acted on.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  readonly refundCents?: number
}
