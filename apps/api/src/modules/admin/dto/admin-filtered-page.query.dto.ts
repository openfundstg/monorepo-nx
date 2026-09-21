import {
  AdminDepositKind,
  AdminDocumentKind,
  AdminSaleFilter,
  type AdminDepositsPageReq,
  type AdminDocumentsPageReq,
  type AdminSalesPageReq
} from '@transacto/contracts'
import { IsEnum, IsOptional } from 'class-validator'
import { AdminPageQueryDto } from './admin-page.query.dto'

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
export class AdminSalesPageQueryDto extends AdminPageQueryDto implements AdminSalesPageReq {
  @IsOptional()
  @IsEnum(AdminSaleFilter)
  readonly filter?: AdminSaleFilter
}

export class AdminDepositsPageQueryDto
  extends AdminPageQueryDto
  implements AdminDepositsPageReq
{
  @IsOptional()
  @IsEnum(AdminDepositKind)
  readonly filter?: AdminDepositKind
}

export class AdminDocumentsPageQueryDto
  extends AdminPageQueryDto
  implements AdminDocumentsPageReq
{
  @IsOptional()
  @IsEnum(AdminDocumentKind)
  readonly filter?: AdminDocumentKind
}
