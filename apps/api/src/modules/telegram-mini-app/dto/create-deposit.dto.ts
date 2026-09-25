import type { CreateDepositReq } from '@transacto/contracts'
import { IsNumber, Min } from 'class-validator'

export class CreateDepositDto implements CreateDepositReq {
  /**
   * USDT in human units, e.g. `10.5`.
   *
   * `@Min(0)` is a shape guard only — the real floor is `MIN_USDT_AMOUNT`,
   * enforced by `DepositFacadeService` so the refusal carries a translated
   * reason rather than a bare validation message.
   */
  @IsNumber()
  @Min(0)
  readonly cryptoAmount: number
}
