import { containsRegex, escapeRegex, exactMatchRegex } from './regex.util'

describe('escapeRegex', () => {
  it('leaves an ordinary term alone', () => {
    expect(escapeRegex('Jar 12')).toBe('Jar 12')
  })

  it.each(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])(
    'escapes %s',
    (char) => {
      expect(new RegExp(escapeRegex(char)).test(char)).toBe(true)
    }
  )

  /** The whole point: a term is a literal, never a pattern. */
  it('stops a wildcard term from matching everything', () => {
    expect(containsRegex('.*').test('Jar 12')).toBe(false)
    expect(containsRegex('.*').test('a.*b')).toBe(true)
  })

  it('does not throw on an unbalanced bracket', () => {
    expect(() => containsRegex('Jar (')).not.toThrow()
    expect(containsRegex('Jar (').test('Jar (main)')).toBe(true)
  })

  /**
   * Inherited from the admin module, which kept its own copy of this function
   * until the two were merged.
   *
   * The admin lists are unscoped — they span every trader and every user — so a
   * catastrophic pattern there is a request that never returns against every
   * collection in the system.
   */
  it('neutralises a catastrophically backtracking pattern', () => {
    expect(escapeRegex('(((((((((.*)*)*)*')).not.toMatch(/[^\\]\(/)
  })

  /** An operator pastes one of these into the sales search box. */
  it('keeps a jar URL usable as a search term', () => {
    const url = 'https://send.monobank.ua/jar/abc?sendId=x'

    expect(containsRegex(url).test(url)).toBe(true)
  })

  /** And a sale's public code, which is what support is quoted. */
  it('leaves an ordinary code matching itself', () => {
    expect(containsRegex('Z38SL69F').test('order Z38SL69F here')).toBe(true)
  })
})

describe('exactMatchRegex', () => {
  it('matches the whole string, ignoring case', () => {
    expect(exactMatchRegex('прокрутка').test('Прокрутка')).toBe(true)
  })

  it('does not match a longer string that merely contains it', () => {
    expect(exactMatchRegex('Jar').test('Jar 12')).toBe(false)
  })
})
