import { AdminSortDirection } from '@transacto/contracts'
import type { AdminPageReq } from '@transacto/contracts'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ADMIN_PAGE, ADMIN_SEARCH_MAX_LENGTH } from 'src/modules/admin/constants'

/**
 * The query every admin list accepts.
 *
 * Inherited by nothing — each list uses it directly, because the only thing
 * that differs between them is which `sort` values mean anything, and that is
 * decided server-side against `ADMIN_SORTABLE` rather than by a per-list DTO.
 *
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so an unknown
 * query parameter is a 400 rather than a silently ignored filter — which is the
 * behaviour worth having on a screen where a filter that does nothing looks
 * exactly like a filter that matched nothing.
 */
export class AdminPageQueryDto implements AdminPageReq {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number

  /**
   * Clamped rather than rejected above the ceiling.
   *
   * `Max()` would answer a request for 500 rows with a validation error; an
   * operator who asks for a lot of rows wants a lot of rows, so the transform
   * gives them as many as the server is willing to serve.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly limit?: number

  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_SEARCH_MAX_LENGTH)
  readonly search?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly sort?: string

  @IsOptional()
  @IsEnum(AdminSortDirection)
  readonly direction?: AdminSortDirection
}

/**
 * The clamp, applied where the value is read rather than in the DTO.
 *
 * A `@Transform` on `limit` would run before `@IsInt`, so a non-numeric value
 * would be clamped into a valid number and never rejected at all.
 */
export const clampLimit = (limit: number | undefined): number =>
  Math.min(limit ?? ADMIN_PAGE.DEFAULT_LIMIT, ADMIN_PAGE.MAX_LIMIT)
