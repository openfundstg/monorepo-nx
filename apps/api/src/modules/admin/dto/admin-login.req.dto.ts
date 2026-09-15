import type { AdminLoginReq } from '@transacto/contracts'
import { IsString, MaxLength, MinLength } from 'class-validator'

/**
 * Length bounds only — the value is compared against the configured credential
 * in constant time, so there is nothing else worth validating here. A pattern
 * check would tell an attacker which submissions were even considered.
 */
export class AdminLoginReqDto implements AdminLoginReq {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  readonly username: string

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  readonly password: string
}
