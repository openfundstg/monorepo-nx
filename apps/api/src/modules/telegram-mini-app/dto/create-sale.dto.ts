import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { SaleRemainderPolicy } from '@transacto/contracts'
import { BankProvider } from 'src/shared/constants'

export class CreateSaleDto {
  /**
   * The order total in UAH kopecks.
   *
   * Only floored at a hryvnia here: the real minimum is in USDT, and this DTO
   * has no exchange rate to convert with. `SaleFacadeService` applies
   * `MIN_USDT_CENTS` once it has computed the stake.
   */
  @IsNumber()
  @Min(100)
  fiatAmount: number

  @IsEnum(BankProvider)
  bankType: BankProvider

  @IsString()
  @IsNotEmpty()
  dropLink: string

  @IsString()
  @IsNotEmpty()
  cardNumber: string

  /**
   * The rate, in kopecks per USDT, that {@link fiatAmount} was worked out at.
   *
   * The market moves while a form is being filled, and the target the user was
   * told to set as their jar's goal moves with it. Without knowing which rate
   * they were quoted, the server cannot tell a stale figure from a current one
   * — it would happily freeze a stake against a target the jar can no longer
   * reach, and the order would sit unfillable until it was blocked.
   */
  @IsNumber()
  @Min(1)
  quotedRate: number

  /**
   * What to do with a tail no payment can cover.
   *
   * Optional, and absent means
   * {@link SaleRemainderPolicy.WAIT_FOR_TOP_UP} — a client that predates
   * the choice must keep getting exactly the behaviour it has always had, not a
   * validation error and not a policy it never asked for.
   */
  @IsOptional()
  @IsEnum(SaleRemainderPolicy)
  remainderPolicy?: SaleRemainderPolicy
}
