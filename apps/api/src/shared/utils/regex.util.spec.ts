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
})

describe('exactMatchRegex', () => {
  it('matches the whole string, ignoring case', () => {
    expect(exactMatchRegex('прокрутка').test('Прокрутка')).toBe(true)
  })

  it('does not match a longer string that merely contains it', () => {
    expect(exactMatchRegex('Jar').test('Jar 12')).toBe(false)
  })
})
