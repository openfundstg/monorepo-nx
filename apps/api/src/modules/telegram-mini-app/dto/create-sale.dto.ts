import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf
} from 'class-validator'
import { SaleMethod, SaleRemainderPolicy } from '@transacto/contracts'
import { BankProvider } from 'src/shared/constants'

export class CreateSaleDto {
  /**
   * Which variant to create.
   *
   * Optional, and absent means {@link SaleMethod.JAR} — a client that
   * predates the choice must keep getting exactly what it has always had.
   */
  @IsOptional()
  @IsEnum(SaleMethod)
  saleMethod?: SaleMethod

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

  /**
   * The USDT to sell, in cents — frozen exactly as sent, once
   * `SaleFacadeService` has checked that {@link fiatAmount} is its price.
   *
   * An integer because it is a count of cents: a fraction of one is a stake no
   * balance can hold. Optional, and absent means the stake is derived from the
   * total, which is all a client that predates it knows how to ask for.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  stakeCents?: number

  @IsEnum(BankProvider)
  bankType: BankProvider

  /**
   * The jar to pay into — required for a jar sale, meaningless for a card one.
   *
   * Conditional rather than simply optional, so a jar sale with no link is
   * still a `400` on the field that is missing. Made optional outright, the
   * same request would reach the resolver and come back as a link-resolution
   * failure, which names the wrong problem.
   */
  @ValidateIf((dto: CreateSaleDto) => dto.saleMethod !== SaleMethod.CARD)
  @IsString()
  @IsNotEmpty()
  dropLink?: string

  @IsString()
  @IsNotEmpty()
  cardNumber: string

  /**
   * Who the payer will see as the recipient — a card sale's, and only its.
   *
   * A jar sale reads this off the bank, which names its own account holder;
   * a card sale has nothing to read, so the seller says. Enforced in
   * `CardSaleDestinationService` rather than here, because the rule is about
   * the variant and not about the string.
   */
  @IsOptional()
  @IsString()
  receiverName?: string

  /**
   * The rate, in kopecks per USDT, that every figure on the form was worked
   * out at.
   *
   * The market moves while a form is being filled. Knowing which rate the user
   * was quoted is what lets the server refuse a figure the screen never showed
   * — any rate but the live one — rather than freeze a stake nobody agreed to.
   */
  @IsNumber()
  @Min(1)
  quotedRate: number

  /**
   * What to do with a tail no payment can cover.
   *
   * Optional, and absent means whatever `defaultRemainderPolicy` says for the
   * method being created — `REFUND_TO_BALANCE`, so an unstated preference never
   * resolves to the one ending that waits on a person.
   *
   * **A named policy the method cannot give is refused, not substituted.**
   * `isRemainderPolicyAvailable` is the rule, shared with the create form so
   * the picker cannot offer what this would reject; `WAIT_FOR_TOP_UP` on a jar
   * is the case today.
   */
  @IsOptional()
  @IsEnum(SaleRemainderPolicy)
  remainderPolicy?: SaleRemainderPolicy
}
