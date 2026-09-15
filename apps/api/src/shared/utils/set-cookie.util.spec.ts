import { readSetCookie } from 'src/shared/utils/set-cookie.util'

/** The header the panel actually sends, attributes and all. */
const REMEMBER =
  'remember_token=714bd1c0b41cc5a958b28136; expires=Tue, 29 Sep 2026 14:32:20 GMT; ' +
  'Max-Age=2592000; path=/'
const SESSION = 'PHPSESSID=2bj8tp57rj66ksdhlvbek8eru8; path=/'
const LANGUAGE = 'trader_ui_lang=ru; path=/; secure; HttpOnly; SameSite=Lax'

describe('readSetCookie', () => {
  it('finds a cookie among the others the panel sets', () => {
    expect(readSetCookie([LANGUAGE, SESSION, REMEMBER], 'remember_token')).toBe(
      '714bd1c0b41cc5a958b28136'
    )
  })

  it('stops at the first attribute, keeping none of them', () => {
    expect(readSetCookie([REMEMBER], 'remember_token')).not.toContain('Max-Age')
  })

  it('reads a cookie that is the only one set', () => {
    expect(readSetCookie([SESSION], 'PHPSESSID')).toBe('2bj8tp57rj66ksdhlvbek8eru8')
  })

  /**
   * The absent cases all mean the same thing to a caller asking for a
   * credential — there isn't one — and each of them has been a real response:
   * a login that failed sets no cookie at all, and a logout clears one by
   * setting it empty.
   */
  it.each([
    ['no header at all', undefined, 'remember_token'],
    ['an empty header', [], 'remember_token'],
    ['a different cookie', [SESSION], 'remember_token'],
    ['a cleared cookie', ['remember_token=; Max-Age=0; path=/'], 'remember_token'],
    ['a malformed entry', ['remember_token'], 'remember_token']
  ])('returns null for %s', (_case, header, name) => {
    expect(readSetCookie(header as string[] | undefined, name)).toBeNull()
  })

  /** Cookie names are case-sensitive, and `PHPSESSID` is not `phpsessid`. */
  it('does not match a name in the wrong case', () => {
    expect(readSetCookie([SESSION], 'phpsessid')).toBeNull()
  })

  /** Base64 and JWT-shaped values both carry `=`, so only the first one splits. */
  it('keeps padding inside the value', () => {
    expect(readSetCookie(['token=YWJjZA==; path=/'], 'token')).toBe('YWJjZA==')
  })

  it('tolerates whitespace around the pair', () => {
    expect(readSetCookie(['  remember_token = abc123 ; path=/'], 'remember_token')).toBe('abc123')
  })
})
