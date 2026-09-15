/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000

/**
 * Narrows a thrown value to a duplicate-key error on one specific field.
 *
 * Checking `keyPattern` rather than just the code is the whole point: a
 * collection can carry several unique indexes, and a duplicate on any *other*
 * one means something genuinely went wrong. A generate-and-retry loop that
 * matched on the code alone would retry that failure five times and then report
 * the wrong error.
 */
export const isDuplicateKeyOn = (error: unknown, field: string): boolean => {
  const candidate = error as { code?: number; keyPattern?: Record<string, unknown> } | null

  return candidate?.code === DUPLICATE_KEY && candidate?.keyPattern?.[field] !== undefined
}

/** MongoDB's "that index is not there" error code. */
const INDEX_NOT_FOUND = 27

/**
 * Whether a thrown value is MongoDB refusing to drop an index it does not have.
 *
 * The one refusal a migration that removes an index may ignore: an index
 * already gone is the state it was trying to reach. Every other failure —
 * a permission, a connection, a collection that is not there — is the database
 * telling a migration something it needs to hear, so the code is checked rather
 * than the whole `catch` being swallowed.
 */
export const isMissingIndex = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === INDEX_NOT_FOUND
