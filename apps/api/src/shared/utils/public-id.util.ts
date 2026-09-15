import { randomBytes } from 'crypto'
import { PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH } from '@transacto/contracts'

/**
 * Number of alphabet characters, hoisted so the rejection bound below is a
 * constant rather than a per-character property read.
 */
const ALPHABET_SIZE = PUBLIC_ID_ALPHABET.length

/**
 * Largest multiple of the alphabet size that fits in a byte.
 *
 * A plain `byte % 36` is biased: 256 is not a multiple of 36, so the first four
 * characters of the alphabet would come up ~14% more often than the rest.
 * Discarding bytes at or above 252 removes the bias at the cost of a ~1.6%
 * resample rate. It matters less for collisions than for not leaking structure
 * in an id users read aloud.
 */
const UNBIASED_CEILING = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE

/**
 * Generates a human-readable sale identifier — digits and uppercase
 * letters, e.g. `Z38SL69F`.
 *
 * Pure and side-effect free: uniqueness is not this function's job. The caller
 * writes against a unique index and retries on a duplicate key, because a
 * generator that pre-checked the collection would still race.
 *
 * `crypto.randomBytes` rather than `Math.random()` because the id is quoted in
 * support conversations and embedded in a terminal name — guessable ids let one
 * user reference another's order.
 */
export const generatePublicId = (): string => {
  const chars: string[] = []

  while (chars.length < PUBLIC_ID_LENGTH) {
    // Over-fetch: on average only ~1.6% of bytes are rejected, so one buffer
    // almost always suffices and the loop rarely runs twice.
    const buffer = randomBytes(PUBLIC_ID_LENGTH)

    for (const byte of buffer) {
      if (byte >= UNBIASED_CEILING) continue
      chars.push(PUBLIC_ID_ALPHABET[byte % ALPHABET_SIZE])
      if (chars.length === PUBLIC_ID_LENGTH) break
    }
  }

  return chars.join('')
}
