import {
  AdminAmountCurrency,
  AdminDepositKind,
  AdminDocumentKind,
  AdminSaleFilter,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus,
  type AdminBookFilters,
  type AdminDepositsPageReq,
  type AdminDocumentsPageReq,
  type AdminSalesPageReq
} from '@transacto/contracts'
import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsISO8601, IsInt, IsOptional, Min } from 'class-validator'
import { AdminPageQueryDto } from './admin-page.query.dto'

/**
 * The narrowing both books share, validated once.
 *
 * Inherited rather than repeated, unlike `filter` below: these fields mean
 * exactly the same thing on both lists, where the slice means a sale method on
 * one and a payment rail on the other. What differs is only which statuses are
 * accepted, and that is a subclass's `@IsIn`.
 *
 * **Dates are validated as ISO-8601 and never parsed here.** The service turns
 * them into a range, because "inclusive to the end of that day" is a decision
 * about what an operator meant and belongs where the query is built.
 */
export abstract class AdminBookFiltersDto extends AdminPageQueryDto implements AdminBookFilters {
  @IsOptional()
  @IsISO8601()
  readonly from?: string

  @IsOptional()
  @IsISO8601()
  readonly to?: string

  @IsOptional()
  @IsEnum(AdminAmountCurrency)
  readonly currency?: AdminAmountCurrency

  /**
   * Base units — kopecks or cents — never hryvnia or USDT.
   *
   * `@Min(0)` rather than `@Min(1)`: a range starting at zero is a legitimate
   * thing to ask for, and it is how an operator says "everything up to".
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  readonly minAmount?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  readonly maxAmount?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly telegramId?: number

  /** Narrowed to the right enum by each list — see the two below. */
  abstract readonly status?: string
}

/**
 * The three lists that offer a named slice, each validated against its own
 * enum.
 *
 * **A DTO per list rather than a `filter?: string` on the base**, because the
 * global `ValidationPipe` is the only thing between a query string and a Mongo
 * filter — and "some string the client sent" is not a value this layer should
 * hand onwards. `@IsEnum` turns an unknown chip into a 400, which is what an
 * operator following a stale bookmark should get rather than a list that
 * silently ignored the filter and looks like the whole book.
 *
 * The base deliberately does not declare the field at all. A base declaration
 * plus a narrowed override is what `useDefineForClassFields` refuses, and the
 * alternative it offers — `declare` — cannot carry a decorator, which would
 * leave the property stripped by `whitelist: true` and the filter silently
 * ignored. So the three lists that have a slice declare one, and the lists that
 * do not answer `filter=anything` with a 400. That is the right answer: a list
 * with no slices has no filter to apply, and pretending otherwise is how a
 * screen ends up showing the whole book under a chip.
 */
export class AdminSalesPageQueryDto extends AdminBookFiltersDto implements AdminSalesPageReq {
  @IsOptional()
  @IsEnum(AdminSaleFilter)
  readonly filter?: AdminSaleFilter

  @IsOptional()
  @IsEnum(TmaSaleStatus)
  readonly status?: TmaSaleStatus
}

export class AdminDepositsPageQueryDto
  extends AdminBookFiltersDto
  implements AdminDepositsPageReq
{
  @IsOptional()
  @IsEnum(AdminDepositKind)
  readonly filter?: AdminDepositKind

  /**
   * Two enums, and a member of either is acceptable.
   *
   * The book is two collections read as one and each rail keeps its own
   * statuses — `@IsEnum` of one would refuse half the legitimate values, and a
   * third enum flattening both would be a status written down in three places
   * and agreeing in two.
   */
  @IsOptional()
  @IsIn([...Object.values(TmaDepositStatus), ...Object.values(TmaFiatDepositStatus)])
  readonly status?: TmaDepositStatus | TmaFiatDepositStatus
}

export class AdminDocumentsPageQueryDto
  extends AdminPageQueryDto
  implements AdminDocumentsPageReq
{
  @IsOptional()
  @IsEnum(AdminDocumentKind)
  readonly filter?: AdminDocumentKind
}
