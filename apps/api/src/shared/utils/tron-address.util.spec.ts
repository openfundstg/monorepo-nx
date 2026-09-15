import { isSameTronAddress, toTronBase58 } from './tron-address.util'

/**
 * The real pair from the incident: TronGrid reported this recipient in hex, the
 * merchant wallet is configured in base58, and the two were compared as
 * strings — so a deposit of 5 USDT that had been paid to exactly the right
 * wallet was rejected as "paid to someone else".
 */
const MERCHANT_HEX = '0x7eb1170aebd7f7bc94c007ae149a0d56b46a4202'
const MERCHANT_BASE58 = 'TMX6HfC2JfpNCBbKx7G2KXxfWFpEi3zULm'

const SENDER_HEX = '0x89cbcb2372e1c2fbc00f24895a406a0c722c89f3'
const SENDER_BASE58 = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'

describe('toTronBase58', () => {
  it('converts the hex TronGrid reports into the wallet address', () => {
    expect(toTronBase58(MERCHANT_HEX)).toBe(MERCHANT_BASE58)
    expect(toTronBase58(SENDER_HEX)).toBe(SENDER_BASE58)
  })

  it('accepts hex with the 41 prefix already applied', () => {
    expect(toTronBase58('417eb1170aebd7f7bc94c007ae149a0d56b46a4202')).toBe(MERCHANT_BASE58)
  })

  it('accepts hex without the 0x, and in either case', () => {
    expect(toTronBase58('7eb1170aebd7f7bc94c007ae149a0d56b46a4202')).toBe(MERCHANT_BASE58)
    expect(toTronBase58('0X7EB1170AEBD7F7BC94C007AE149A0D56B46A4202')).toBe(MERCHANT_BASE58)
  })

  it('returns an address that is already base58 unchanged', () => {
    expect(toTronBase58(MERCHANT_BASE58)).toBe(MERCHANT_BASE58)
  })

  it('trims whitespace, which a pasted env var routinely carries', () => {
    expect(toTronBase58(`  ${MERCHANT_BASE58}  `)).toBe(MERCHANT_BASE58)
    expect(toTronBase58(`\n${MERCHANT_HEX}\n`)).toBe(MERCHANT_BASE58)
  })

  it('produces an address of the shape TRON uses', () => {
    const address = toTronBase58(MERCHANT_HEX)

    expect(address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)
    expect(address).toHaveLength(34)
  })

  /**
   * `null`, never a half-converted string — a caller comparing wallets has to
   * be able to tell "a different address" from "I could not tell".
   */
  it.each([
    ['empty', ''],
    ['not hex at all', 'hello world'],
    ['too short', '0x7eb1170a'],
    ['too long', `${MERCHANT_HEX}deadbeef`],
    ['hex of the wrong prefix', `42${'7eb1170aebd7f7bc94c007ae149a0d56b46a4202'}`],
    ['a base58 string that is not an address', 'TOO_SHORT']
  ])('returns null for %s', (_label, value) => {
    expect(toTronBase58(value)).toBeNull()
  })
})

describe('isSameTronAddress', () => {
  /** The comparison the deposit check actually needs. */
  it('matches hex against base58 for the same wallet', () => {
    expect(isSameTronAddress(MERCHANT_HEX, MERCHANT_BASE58)).toBe(true)
    expect(isSameTronAddress(MERCHANT_BASE58, MERCHANT_HEX)).toBe(true)
  })

  it('matches either form against itself', () => {
    expect(isSameTronAddress(MERCHANT_HEX, MERCHANT_HEX)).toBe(true)
    expect(isSameTronAddress(MERCHANT_BASE58, MERCHANT_BASE58)).toBe(true)
  })

  /** Money paid to somebody else must still be rejected. */
  it('does not match two different wallets', () => {
    expect(isSameTronAddress(SENDER_HEX, MERCHANT_BASE58)).toBe(false)
    expect(isSameTronAddress(SENDER_BASE58, MERCHANT_HEX)).toBe(false)
  })

  /**
   * Base58 is case-sensitive, so the old `toLowerCase()` comparison was wrong
   * in principle: it treated a string that is not a valid address as equal to
   * one that is.
   */
  it('does not match on case alone', () => {
    expect(isSameTronAddress(MERCHANT_BASE58.toLowerCase(), MERCHANT_BASE58)).toBe(false)
  })

  it('never matches when either side is unreadable', () => {
    expect(isSameTronAddress('', MERCHANT_BASE58)).toBe(false)
    expect(isSameTronAddress(MERCHANT_BASE58, 'not-an-address')).toBe(false)
    expect(isSameTronAddress('', '')).toBe(false)
  })
})
