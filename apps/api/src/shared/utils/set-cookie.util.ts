/**
 * Reading one cookie out of a `set-cookie` response header.
 *
 * Axios does not manage a cookie jar in Node, and pulling in one that does
 * would be a dependency for a single 30-day token. The panel sets three
 * cookies and exactly one of them matters, so this reads that one.
 *
 * Values here are session credentials — never log what this returns.
 */

/** Separates a cookie's `name=value` pair from its attributes. */
const ATTRIBUTE_SEPARATOR = ';'

/** Separates the name from the value. Only the first one splits: a value may contain `=`. */
const NAME_VALUE_SEPARATOR = '='

/**
 * The value of `name` in a `set-cookie` header, or `null` when it is absent.
 *
 * Node hands `set-cookie` back as an array — one entry per cookie — even for a
 * single cookie, and it is missing entirely from responses that set none, so
 * both shapes have to be accepted.
 *
 * A cookie present with an empty value returns `null`: that is how a server
 * clears one, and a caller asking for a credential wants nothing back rather
 * than an empty string that reads as truthy in some places and not others.
 */
export const readSetCookie = (
  setCookie: readonly string[] | undefined,
  name: string
): string | null => {
  if (!setCookie) return null

  for (const entry of setCookie) {
    const [pair] = entry.split(ATTRIBUTE_SEPARATOR)
    const separator = pair.indexOf(NAME_VALUE_SEPARATOR)
    if (separator === -1) continue

    if (pair.slice(0, separator).trim() !== name) continue

    const value = pair.slice(separator + 1).trim()
    return value.length > 0 ? value : null
  }

  return null
}
