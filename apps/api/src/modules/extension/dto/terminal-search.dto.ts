import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'

/** Bounds on the search itself, so the values are not literals in the service. */
export const TerminalSearch = {
  /**
   * Below this a query matches most of a trader's terminals, and the ranking
   * has nothing to work with. The client does not send one either.
   */
  MIN_TERM_LENGTH: 2,
  /** Long enough for any terminal name; anything beyond is a paste accident. */
  MAX_TERM_LENGTH: 128,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 50
} as const

export class TerminalSearchQueryDto {
  /**
   * Trimmed before validation, so a term of nothing but spaces is rejected as
   * too short rather than running as a regex that matches every terminal.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(TerminalSearch.MIN_TERM_LENGTH, TerminalSearch.MAX_TERM_LENGTH)
  readonly q!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TerminalSearch.MAX_LIMIT)
  readonly limit?: number = TerminalSearch.DEFAULT_LIMIT
}
