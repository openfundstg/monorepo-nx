import type { AdminSetTerminalStateReq } from '@transacto/contracts'
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ADMIN_REASON_MAX_LENGTH } from 'src/modules/admin/constants'

/**
 * Moving a terminal's two independent flags.
 *
 * Both optional so one can be changed without restating the other. The service
 * refuses a body that sets neither — a request that changes nothing is a bug in
 * the caller, and answering it `200` hides that.
 */
export class AdminSetTerminalStateReqDto implements AdminSetTerminalStateReq {
  @IsOptional()
  @IsBoolean()
  readonly enabled?: boolean

  @IsOptional()
  @IsBoolean()
  readonly acceptingOrders?: boolean

  @IsString()
  @MinLength(1)
  @MaxLength(ADMIN_REASON_MAX_LENGTH)
  readonly reason: string
}
