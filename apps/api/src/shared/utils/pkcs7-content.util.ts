import type { ReceiptFile } from 'src/shared/interfaces'
/**
 * Getting the PDF out of a bank's signed receipt.
 *
 * **Why this exists.** `https://api.monobank.ua/bank/receipt/…` answers
 * `Content-Type: application/pdf` and does not send a PDF. The bytes are a DER
 * PKCS#7 `SignedData` container — the receipt carrying a qualified electronic
 * signature — with the actual document as its encapsulated content. Handing
 * those bytes to Transacto's recognition would fail as surely as handing it a
 * ZIP, and it would fail *quietly*, as a receipt that could not be read.
 *
 * **What this does not do: verify the signature.** It reads the envelope and
 * throws the envelope away. The signature is DSTU-4145 over GOST 34.311, which
 * no algorithm in Node or in OpenSSL's default build can check — `openssl smime
 * -verify` on one of these fails with `unsupported: DSTU Gost 34311-95` — so
 * verifying it would mean a Ukrainian crypto provider this workspace does not
 * have. Authenticity is established elsewhere and differently: the state
 * receipt service is asked whether the code names a real payment, and this
 * document is only ever fetched *after* it has said yes. Nothing here may be
 * read as a claim that the file is genuine.
 *
 * Captured 2026-09-07 against a live monobank receipt: 182 265 bytes in,
 * 178 616 bytes of `%PDF-1.4` … `%%EOF` out.
 */

/** How deep the walk will go before deciding the structure is not what we think. */
const MAX_DEPTH = 8

/** The DER tag for a primitive OCTET STRING — the shape `eContent` arrives in. */
const OCTET_STRING = 0x04

/** Set on a DER tag byte when its content is itself a sequence of TLVs. */
const CONSTRUCTED_BIT = 0x20

/** What every PDF starts with, and the only way one is recognised here. */
const PDF_MAGIC = '%PDF-'

/** One DER tag-length-value header, as read off the wire. */
interface DerHeader {
  readonly tag: number
  /** Offset of the first content byte. */
  readonly contentStart: number
  /** Content length, or `null` for the indefinite form. */
  readonly length: number | null
  readonly constructed: boolean
}

/**
 * The document inside a PKCS#7 container, or `null` if there is none.
 *
 * Deliberately structural rather than a search for the `%PDF-` marker: that
 * string also occurs inside the signed document's own metadata and inside any
 * PDF that embeds another, so a scan would sometimes return a fragment that
 * starts in the right place and ends nowhere. This walks the DER tree and
 * returns an OCTET STRING whose content *begins* a PDF, which is a thing the
 * container either has or does not.
 *
 * A file that is already a plain PDF is returned unchanged, so callers do not
 * have to know which they were given.
 */
export const extractSignedPdf = (data: Buffer): Buffer | null => {
  if (startsWithPdf(data)) return data

  return findPdfOctetString(data, 0, data.length, 0)
}

/** Whether these bytes are a PDF in their own right. */
export const startsWithPdf = (data: Buffer): boolean =>
  data.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC

/**
 * Depth-first search for the OCTET STRING holding the document.
 *
 * Recursion is bounded by {@link MAX_DEPTH} rather than by the structure: a
 * malformed or hostile container is a file somebody uploaded, and a walk over
 * one must end whatever it finds.
 */
const findPdfOctetString = (
  data: Buffer,
  from: number,
  until: number,
  depth: number
): Buffer | null => {
  let cursor = from

  while (cursor < until) {
    const header = readDerHeader(data, cursor, until)
    if (header === null) return null

    const contentEnd =
      header.length === null ? until : Math.min(header.contentStart + header.length, until)

    if (contentEnd <= header.contentStart) return null

    if (header.tag === OCTET_STRING && !header.constructed) {
      const content = data.subarray(header.contentStart, contentEnd)
      if (startsWithPdf(content)) return content
    }

    if (header.constructed && depth < MAX_DEPTH) {
      const found = findPdfOctetString(data, header.contentStart, contentEnd, depth + 1)
      if (found !== null) return found
    }

    cursor = contentEnd
  }

  return null
}

/**
 * One DER header, or `null` when the bytes cannot be one.
 *
 * Handles the long form — a monobank receipt uses three length bytes, which is
 * why the short form alone would read the very first tag wrongly — and the
 * indefinite form, which is legal in BER and which callers must treat as
 * "runs to the end of the enclosing value".
 */
const readDerHeader = (data: Buffer, offset: number, until: number): DerHeader | null => {
  if (offset + 2 > until) return null

  const tag = data[offset]
  const firstLengthByte = data[offset + 1]
  const constructed = (tag & CONSTRUCTED_BIT) !== 0

  if (firstLengthByte < 0x80)
    return { tag, contentStart: offset + 2, length: firstLengthByte, constructed }

  if (firstLengthByte === 0x80) return { tag, contentStart: offset + 2, length: null, constructed }

  const lengthBytes = firstLengthByte & 0x7f
  // Four bytes already reach 4 GB, and anything claiming more than that is a
  // corrupt header rather than a large receipt.
  if (lengthBytes > 4 || offset + 2 + lengthBytes > until) return null

  const length = data.readUIntBE(offset + 2, lengthBytes)

  return { tag, contentStart: offset + 2 + lengthBytes, length, constructed }
}

/**
 * The document inside a signed envelope, or the file exactly as it came.
 *
 * The three-line wrapper around {@link extractSignedPdf} that two places need:
 * the facade, which reads text out of it, and the top-up, which forwards it to
 * Transacto. Both had written it out for themselves, which is two chances for
 * one of them to stop doing it.
 *
 * **What comes back is for reading and forwarding, never for verifying.** A
 * qualified signature is over the envelope's precise bytes, so anything
 * checking one must be handed the original — see `ReceiptSubmission`, which
 * carries both for exactly this reason. Identity is preserved when there was
 * nothing to unwrap, so a caller can tell whether it happened and say so.
 */
export const withoutSignatureEnvelope = (file: ReceiptFile): ReceiptFile => {
  const pdf = extractSignedPdf(file.buffer)

  if (pdf === null || pdf === file.buffer) return file

  return { ...file, buffer: pdf, mimeType: 'application/pdf' }
}
