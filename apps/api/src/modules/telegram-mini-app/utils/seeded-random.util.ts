/**
 * A seeded stream of choices: the same seed draws the same sequence, every
 * time, in every process.
 *
 * For stories that must retell identically without being stored — a demo
 * account's history is drawn from one on every open. Not for anything secret:
 * nothing about the sequence is hard to guess, and nothing needs it to be.
 */
export interface SeededRandom {
  /** A number in `[0, 1)`. */
  readonly fraction: () => number
  /** A number in `[min, max)`. */
  readonly between: (min: number, max: number) => number
  /** A whole number in `[min, max]`. */
  readonly int: (min: number, max: number) => number
  readonly chance: (probability: number) => boolean
  readonly pick: <T>(items: readonly T[]) => T
  /** `length` characters drawn from `alphabet`. */
  readonly chars: (alphabet: string, length: number) => string
}

const UINT32_RANGE = 2 ** 32

/** Mulberry32: small, fast, and entirely determined by its seed. */
export const seededRandom = (seed: number): SeededRandom => {
  // The generator's state, and the only thing here that is reassigned:
  // advancing it is what makes consecutive draws differ.
  let state = seed | 0

  const fraction = (): number => {
    state = (state + 0x6d2b79f5) | 0
    const mixed = Math.imul(state ^ (state >>> 15), state | 1)
    const scrambled = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))

    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / UINT32_RANGE
  }
  const between = (min: number, max: number): number => min + fraction() * (max - min)
  const int = (min: number, max: number): number => Math.floor(between(min, max + 1))

  return {
    fraction,
    between,
    int,
    chance: (probability) => fraction() < probability,
    pick: (items) => items[int(0, items.length - 1)],
    chars: (alphabet, length) =>
      Array.from({ length }, () => alphabet[int(0, alphabet.length - 1)]).join('')
  }
}

/**
 * A seed from a number that may be wider than 32 bits — a Telegram id is —
 * folded rather than truncated, so ids differing only above bit 32 still draw
 * different sequences.
 */
export const seedFrom = (value: number): number =>
  Math.floor(value / UINT32_RANGE) ^ (value % UINT32_RANGE)
