import { extractSignedPdf, startsWithPdf } from './pkcs7-content.util'

/**
 * One DER tag-length-value, with the long form whenever the content needs it.
 *
 * The long form is the point of testing at all: a real monobank receipt is
 * 182 265 bytes and its very first length is three bytes wide, so a reader that
 * only understood the short form would misread the outermost tag and find
 * nothing.
 */
const tlv = (tag: number, content: Buffer): Buffer => {
  if (content.length < 0x80) return Buffer.concat([Buffer.from([tag, content.length]), content])

  const length: number[] = []
  for (let remaining = content.length; remaining > 0; remaining = Math.floor(remaining / 256))
    length.unshift(remaining % 256)

  return Buffer.concat([Buffer.from([tag, 0x80 | length.length, ...length]), content])
}

const SEQUENCE = 0x30
const CONTEXT_0 = 0xa0
const OCTET_STRING = 0x04
const OID = 0x06

/** A PKCS#7 `SignedData` shaped like the one monobank serves. */
const signedContainer = (document: Buffer): Buffer =>
  tlv(
    SEQUENCE,
    Buffer.concat([
      tlv(OID, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02])),
      tlv(
        CONTEXT_0,
        tlv(
          SEQUENCE,
          Buffer.concat([
            tlv(0x02, Buffer.from([0x01])),
            tlv(0x31, Buffer.alloc(12)),
            tlv(
              SEQUENCE,
              Buffer.concat([
                tlv(OID, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01])),
                tlv(CONTEXT_0, tlv(OCTET_STRING, document))
              ])
            )
          ])
        )
      )
    ])
  )

/** Large enough that every length in the container above takes the long form. */
const aPdf = (): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 0x41), Buffer.from('\n%%EOF\n')])

describe('extractSignedPdf', () => {
  it('returns the document inside a signed container', () => {
    const document = aPdf()

    expect(extractSignedPdf(signedContainer(document))).toEqual(document)
  })

  /**
   * A caller must not have to know which of the two it was handed — a user
   * uploads whichever their phone saved.
   */
  it('returns a plain PDF unchanged, and identically', () => {
    const document = aPdf()

    expect(extractSignedPdf(document)).toBe(document)
  })

  /**
   * The whole point of walking the structure rather than searching for `%PDF-`:
   * that string occurs inside a signed document's own metadata and inside any
   * PDF that embeds another, and a scan would return a fragment that starts in
   * the right place and ends nowhere.
   */
  it('ignores the marker when it is not the start of an octet string', () => {
    const decoy = tlv(
      SEQUENCE,
      Buffer.concat([tlv(OCTET_STRING, Buffer.from('a %PDF-1.4 mention, not a document'))])
    )

    expect(extractSignedPdf(decoy)).toBeNull()
  })

  it.each([
    ['an image', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])],
    ['a truncated header', Buffer.from([0x30])],
    ['nothing at all', Buffer.alloc(0)]
  ])('returns null for %s', (_name, data) => {
    expect(extractSignedPdf(data)).toBeNull()
  })

  /**
   * A container is a file somebody uploaded. A walk over a malformed one has to
   * end, whatever it finds — and a length claiming more than four bytes is a
   * corrupt header rather than a large receipt.
   */
  it('gives up on a header claiming an impossible length', () => {
    const absurd = Buffer.from([SEQUENCE, 0x88, 1, 2, 3, 4, 5, 6, 7, 8, 0x00])

    expect(extractSignedPdf(absurd)).toBeNull()
  })
})

describe('startsWithPdf', () => {
  it.each([
    [Buffer.from('%PDF-1.7 whatever'), true],
    [Buffer.from(' %PDF-1.7'), false],
    [Buffer.from('%PD'), false]
  ])('reads %s as %s', (data, expected) => {
    expect(startsWithPdf(data)).toBe(expected)
  })
})
