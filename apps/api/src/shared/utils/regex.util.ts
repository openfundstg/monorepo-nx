/** Characters that mean something to a regex engine and nothing to a user. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g

/**
 * Makes a user-supplied string safe to embed in a regular expression.
 *
 * Mongo's `$regex` compiles whatever it is given, so a search term reaches the
 * engine as a pattern. A trader typing a jar name that happens to contain `(`
 * would otherwise get a `SyntaxError` back as a 500, and a term of `.*` would
 * quietly match every terminal they own.
 */
export const escapeRegex = (value: string): string => value.replace(REGEX_METACHARACTERS, '\\$&')

/** An anchored, case-insensitive exact match on a literal string. */
export const exactMatchRegex = (value: string): RegExp =>
  new RegExp(`^${escapeRegex(value)}$`, 'i')

/** A case-insensitive "contains this literal string" match. */
export const containsRegex = (value: string): RegExp => new RegExp(escapeRegex(value), 'i')
