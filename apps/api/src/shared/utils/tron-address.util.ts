import { createHash } from 'node:crypto'

/** Bitcoin-style base58 — no 0, O, I or l, so the alphabet has 58 symbols. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** TRON mainnet address prefix. Every base58 address starts `T` because of it. */
const MAINNET_PREFIX = '41'

/** 20 address bytes as hex, before the prefix is added. */
const RAW_HEX_LENGTH = 40

/** The same 20 bytes with the `41` prefix already on them. */
const PREFIXED_HEX_LENGTH = 42

/** A well-formed base58 TRON address: `T` plus 33 more base58 characters. */
const BASE58_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest()

/** Big-endian bytes → base58, preserving leading zero bytes as `1`s. */
const encodeBase58 = (bytes: Buffer): string => {
  let remaining = BigInt(`0x${bytes.toString('hex')}`)
  let encoded = ''

  while (remaining > 0n) {
    encoded = BASE58_ALPHABET[Number(remaining % 58n)] + encoded
    remaining /= 58n
  }

  // A leading zero byte carries no value, so the loop above drops it — base58
  // represents each one as a literal '1'. TRON's `41` prefix means this never
  // fires here, but leaving it out would make the function wrong in general.
  for (const byte of bytes) {
    if (byte !== 0) break
    encoded = `1${encoded}`
  }

  return encoded
}

/**
 * Converts a TRON address to its canonical base58check form.
 *
 * TronGrid reports the parties to a TRC-20 transfer as **hex**
 * (`0x7eb1170aebd7f7bc94c007ae149a0d56b46a4202`), while a wallet address is
 * written in base58 (`TMX6HfC2JfpNCBbKx7G2KXxfWFpEi3zULm`). They are the same
 * 20 bytes in two encodings — but compared as strings they never match, which
 * rejected deposits that had genuinely been paid to the right wallet.
 *
 * The encoding is `base58(0x41 ‖ address ‖ first 4 bytes of sha256²)`: the
 * mainnet prefix is what makes every TRON address begin with `T`, and the
 * four-byte checksum is what makes a mistyped one detectable.
 *
 * Accepts an address that is already base58 and returns it unchanged, so
 * callers do not have to know which form they were handed.
 *
 * @returns the base58 address, or `null` when the input is not one — never a
 *   half-converted string, because a caller comparing wallets must be able to
 *   tell "different address" from "could not tell".
 */
export const toTronBase58 = (value: string): string | null => {
  const trimmed = value.trim()
  if (BASE58_ADDRESS.test(trimmed)) return trimmed

  const hex = trimmed.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex)) return null

  const prefixed =
    hex.length === RAW_HEX_LENGTH
      ? `${MAINNET_PREFIX}${hex}`
      : hex.length === PREFIXED_HEX_LENGTH && hex.startsWith(MAINNET_PREFIX)
        ? hex
        : null
  if (!prefixed) return null

  const payload = Buffer.from(prefixed, 'hex')
  const checksum = sha256(sha256(payload)).subarray(0, 4)

  return encodeBase58(Buffer.concat([payload, checksum]))
}

/**
 * Whether two TRON addresses are the same wallet, whatever form each arrived in.
 *
 * Compared exactly rather than case-insensitively: base58 is case-sensitive, so
 * lower-casing both sides would treat addresses differing only in case as
 * equal — and one of them would not be a real address at all.
 *
 * Returns `false` when either side cannot be understood, so an unparseable
 * address can never be mistaken for a match.
 */
export const isSameTronAddress = (left: string, right: string): boolean => {
  const a = toTronBase58(left)
  const b = toTronBase58(right)

  return a !== null && b !== null && a === b
}
