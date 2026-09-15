import { PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from '@transacto/contracts'
import { generatePublicId } from './public-id.util'

describe('generatePublicId', () => {
  it('produces the contracted length', () => {
    expect(generatePublicId()).toHaveLength(PUBLIC_ID_LENGTH)
  })

  it('produces only digits and uppercase letters', () => {
    for (let i = 0; i < 500; i++) expect(generatePublicId()).toMatch(PUBLIC_ID_PATTERN)
  })

  it('never emits a character outside the contracted alphabet', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) for (const char of generatePublicId()) seen.add(char)

    for (const char of seen) expect(PUBLIC_ID_ALPHABET).toContain(char)
  })

  /**
   * Not a uniqueness guarantee — that is the unique index's job. This only
   * catches a generator that has collapsed to a constant or a tiny period,
   * which a length/alphabet assertion would happily pass.
   */
  it('does not repeat across a large sample', () => {
    const ids = new Set(Array.from({ length: 5_000 }, generatePublicId))

    expect(ids.size).toBe(5_000)
  })

  /**
   * The rejection sampling exists so no character is favoured. With 5000 * 8
   * draws over 36 symbols the expected count is ~1111 each; a biased modulo
   * would push the first four symbols to ~1270 and the rest to ~1230 or below.
   */
  it('distributes characters without modulo bias', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 5_000; i++)
      for (const char of generatePublicId()) counts.set(char, (counts.get(char) ?? 0) + 1)

    expect(counts.size).toBe(PUBLIC_ID_ALPHABET.length)

    const expected = (5_000 * PUBLIC_ID_LENGTH) / PUBLIC_ID_ALPHABET.length
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.8)
      expect(count).toBeLessThan(expected * 1.2)
    }
  })
})
