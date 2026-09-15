/**
 * The shape every paginated database read takes, and the shape it returns.
 *
 * Declared once at the repository root rather than per `-db` module because
 * eleven collections are listed by the admin panel and each one was otherwise
 * about to grow its own `{ page, limit, sortBy, sortOrder }` quadruple. The
 * skip is computed by the caller — a DB service takes an offset, not a page
 * number, because page arithmetic is a presentation decision.
 */
export interface PageQuery {
  readonly skip: number
  readonly limit: number
  /** Mongo sort spec, e.g. `{ createdAt: -1 }`. */
  readonly sort: Readonly<Record<string, 1 | -1>>
}

/**
 * One page of rows plus the size of the whole match.
 *
 * `total` is counted against the same filter, so a client can say "41–60 of
 * 812" rather than discovering the end by walking into it.
 */
export interface Page<T> {
  readonly items: T[]
  readonly total: number
}
