import { extractSignedPdf } from './pkcs7-content.util'

describe('extractSignedPdf under hostile input', () => {
  const budgetMs = 2000

  it('survives random bytes', () => {
    const started = Date.now()
    for (let i = 0; i < 3000; i++) {
      const size = 1 + Math.floor(Math.random() * 512)
      const buf = Buffer.alloc(size)
      for (let j = 0; j < size; j++) buf[j] = Math.floor(Math.random() * 256)
      extractSignedPdf(buf)
    }
    expect(Date.now() - started).toBeLessThan(budgetMs)
  })

  /** A container claiming far more content than it carries. */
  it('survives a length that overruns the buffer', () => {
    expect(extractSignedPdf(Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff, 0x04, 0x01]))).toBeNull()
  })

  /** Deeply nested constructed tags — the stack-overflow shape. */
  it('survives deep nesting', () => {
    let buf = Buffer.from([0x04, 0x01, 0x41])
    for (let i = 0; i < 5000; i++) buf = Buffer.concat([Buffer.from([0x30, 0x81, buf.length]), buf])
    const started = Date.now()
    expect(() => extractSignedPdf(buf)).not.toThrow()
    expect(Date.now() - started).toBeLessThan(budgetMs)
  })

  /** Many sibling tags — the quadratic shape. */
  it('survives a very wide structure', () => {
    const leaf = Buffer.from([0x04, 0x02, 0x41, 0x42])
    const wide = Buffer.concat(Array.from({ length: 200_000 }, () => leaf))
    const started = Date.now()
    extractSignedPdf(Buffer.concat([Buffer.from([0x30, 0x84]), lengthOf(wide), wide]))
    expect(Date.now() - started).toBeLessThan(budgetMs)
  })

  /** Indefinite-length form, which has no declared end. */
  it('survives indefinite lengths nested in each other', () => {
    let buf = Buffer.from([0x04, 0x01, 0x41])
    for (let i = 0; i < 200; i++) buf = Buffer.concat([Buffer.from([0x30, 0x80]), buf])
    expect(() => extractSignedPdf(buf)).not.toThrow()
  })
})

const lengthOf = (b: Buffer): Buffer => {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(b.length)
  return out
}
