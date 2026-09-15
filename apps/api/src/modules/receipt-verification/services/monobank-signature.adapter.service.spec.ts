import { BankProvider } from '@transacto/contracts'
import { AttestedDocumentKind, ReceiptLookupResult } from 'src/modules/receipt-verification/enums'
import {
  MONOBANK_CA_TOTAL_PASSED,
  MONOBANK_SIGNERS,
  type MonobankCaVerifyResponse,
  type ReceiptFile
} from 'src/shared/interfaces'
import type { ReceiptSubmission } from 'src/modules/receipt-verification/interfaces'
import type { MonobankCaApiService } from './monobank-ca.api.service'
import type { ReceiptCheckerApiService } from './receipt-checker.api.service'
import { MonobankSignatureAdapterService } from './monobank-signature.adapter.service'

const CODE = '6K4A-0000-0000-0000'

const TEXT =
  `Квитанція № ${CODE} від 08.09.2026 ` +
  "Відправник Ім'я Петренко Петро Банк Універсал Банк " +
  'Платіжний інструмент UA510000000000000000000000005, 4441 1111 1111 1111 ' +
  "Одержувач Ім'я Михайло М. Банк одержувач Універсал Банк " +
  'Платіжний інструмент 5375 4141 2222 3333 ' +
  'Сума (грн) 1 100.00 Комісія (грн) 0.00 Дата і час операції 08.09.2026 15:15'

const file = (name: string, body: string): ReceiptFile => ({
  buffer: Buffer.from(body),
  fileName: name,
  mimeType: 'application/pdf'
})

/** The envelope that gets verified, and the document that gets forwarded. */
const ENVELOPE = file('receipt.p7s', 'the signed container')
const DOCUMENT = file('receipt.pdf', 'the document inside')

const submission = (overrides: Partial<ReceiptSubmission> = {}): ReceiptSubmission => ({
  bank: BankProvider.MONO,
  code: CODE,
  uploaded: ENVELOPE,
  document: DOCUMENT,
  text: TEXT,
  ...overrides
})

const signature = (organization: string, issuer: string, valid = true) => ({
  valid,
  mainIndication: MONOBANK_CA_TOTAL_PASSED,
  tspStatus: 'VALID',
  signingTime: '2026-09-08T12:15:44Z',
  tspTime: '2026-09-08T12:15:44Z',
  bestSignatureTime: '2026-09-08T12:15:44Z',
  hashAlgorithm: 'ГОСТ 34.311-95',
  signAlgorithm: 'ДСТУ 4145-2002',
  fileHashHex: 'ab'.repeat(32),
  signatureFormat: 'CAdES-BES',
  signType: 'Кваліфікований',
  signerCert: {
    commonName: 'Петренко Олена Іванівна',
    organization,
    serialNumber: '10FF',
    issuer,
    notBefore: '2025-12-15T00:00:00Z',
    notAfter: '2027-12-14T23:59:59Z',
    signatureAlgorithm: 'ДСТУ 4145-2002'
  },
  certChain: []
})

/**
 * The two certificates monobank has been observed signing under.
 *
 * Taken from the list rather than written out, so a third one added there is
 * covered here by construction — and so these tests cannot pass against a pair
 * the product does not actually accept.
 */
const [OWN_KNEDP, VIA_DIIA] = MONOBANK_SIGNERS

const answer = (
  overrides: Partial<MonobankCaVerifyResponse> = {},
  signatures = [signature(OWN_KNEDP.organization, OWN_KNEDP.issuer)]
): MonobankCaVerifyResponse => ({
  signatureValid: true,
  protocolInfo: {
    signatureValid: true,
    mainIndication: MONOBANK_CA_TOTAL_PASSED,
    detachedMode: false,
    verifiedAt: '2026-09-08T17:48:29Z',
    validationProcess: 'urn:etsi:019102:validationprocess:Basic',
    signatures
  },
  protocolFileUrl: 'https://ra.monobank.com.ua/api/web/protocol/x.pdf',
  validationReportXml: '',
  ...overrides
})

const build = (verify: jest.Mock) =>
  new MonobankSignatureAdapterService(
    { verify } as unknown as MonobankCaApiService,
    {
      isConfigured: true,
      extractText: jest.fn(async () => ({ text: TEXT, source: 'PDF_TEXT' }))
    } as unknown as ReceiptCheckerApiService
  )

describe('MonobankSignatureAdapterService — a genuine receipt', () => {
  it('vouches for it and reports what the document says', async () => {
    const verify = jest.fn(async () => answer())

    const result = await build(verify).vouchFor(submission())

    expect(result.result).toBe(ReceiptLookupResult.FOUND)
    if (result.result !== ReceiptLookupResult.FOUND) return

    expect(result.receipt.amountUah).toBe(110000)
    expect(result.receipt.recipient).toBe('5375414122223333')
    expect(result.receipt.currencyCode).toBe(980)
    expect(result.receipt.paidAt.toISOString()).toBe('2026-09-08T12:15:00.000Z')
  })

  /**
   * A qualified signature is over the uploaded bytes. Unwrapping first hands
   * the service a document it must refuse, which would fail every genuine
   * receipt — so what goes up is the envelope.
   */
  it('sends the envelope to be verified, not the document inside it', async () => {
    const verify = jest.fn(async () => answer())

    await build(verify).vouchFor(submission())

    expect(verify).toHaveBeenCalledWith(ENVELOPE)
  })

  /**
   * And forwards the other one. Transacto's recognition reads a PDF and reports
   * a PKCS#7 container as an unreadable file, in the one way that looks like the
   * user's fault.
   */
  it('hands back the document rather than the envelope', async () => {
    const result = await build(jest.fn(async () => answer())).vouchFor(submission())

    if (result.result !== ReceiptLookupResult.FOUND) throw new Error('expected FOUND')

    expect(result.receipt.document).toEqual({ kind: AttestedDocumentKind.FILE, file: DOCUMENT })
  })

  /** The document's own number wins over one read off a file's name. */
  it('records the number the document prints, not the one it was asked about', async () => {
    const result = await build(jest.fn(async () => answer())).vouchFor(
      submission({ code: 'AAAA-BBBB-CCCC-DDDD' })
    )

    if (result.result !== ReceiptLookupResult.FOUND) throw new Error('expected FOUND')

    expect(result.receipt.code).toBe(CODE)
  })
})

/**
 * **The check that carries the whole design.**
 *
 * `signatureValid` says a signature is cryptographically sound, and nothing
 * more. A qualified certificate can be bought by anybody, so a forger can sign
 * a receipt they invented and this service will confirm — truthfully — that the
 * signature is valid. Without the signer test that is a forgery laundry.
 */
describe('MonobankSignatureAdapterService — a signature that is not the bank’s', () => {
  it('refuses a valid signature from another organisation', async () => {
    const verify = jest.fn(async () =>
      answer({}, [signature('ТОВ «Хтось Інший»', OWN_KNEDP.issuer)])
    )

    const result = await build(verify).vouchFor(submission())

    expect(result.result).toBe(ReceiptLookupResult.UNKNOWN)
  })

  it('refuses a valid signature from another issuer', async () => {
    const verify = jest.fn(async () =>
      answer({}, [signature(OWN_KNEDP.organization, 'КНЕДП Хтось Інший')])
    )

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.UNKNOWN)
  })

  /**
   * The morning this became real. On 10 Sep 2026 monobank began signing under a
   * Diia-issued certificate naming the bank by its full legal title, and a
   * single hard-coded pair refused every genuine receipt from that hour on —
   * logging each one as a probable forgery.
   */
  it('accepts the certificate the bank moved to', async () => {
    const verify = jest.fn(async () =>
      answer({}, [signature(VIA_DIIA.organization, VIA_DIIA.issuer)])
    )

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.FOUND)
  })

  /**
   * The halves may not be mixed. Accepting any known organisation under any
   * known issuer would be a wider claim than anything observed — and the issuer
   * is what connects a certificate to the legal entity it names.
   */
  it('refuses one signer’s organisation under the other’s issuer', async () => {
    const verify = jest.fn(async () =>
      answer({}, [signature(OWN_KNEDP.organization, VIA_DIIA.issuer)])
    )

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.UNKNOWN)
  })

  it('accepts the bank’s signature even when the document carries another beside it', async () => {
    const verify = jest.fn(async () =>
      answer({}, [
        signature('ТОВ «Хтось Інший»', 'КНЕДП Хтось Інший'),
        signature(OWN_KNEDP.organization, OWN_KNEDP.issuer)
      ])
    )

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.FOUND)
  })
})

describe('MonobankSignatureAdapterService — everything that is not a vouch', () => {
  /** One flipped bit. Their answer is a `200` carrying a negative verdict. */
  it('refuses a document whose signature does not check out', async () => {
    const verify = jest.fn(async () =>
      answer({
        signatureValid: false,
        protocolInfo: {
          ...answer().protocolInfo,
          signatureValid: false,
          mainIndication: 'urn:etsi:019102:mainindication:total-failed'
        }
      })
    )

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.UNKNOWN)
  })

  /** A screenshot or a re-printed PDF — their `400`, and a fact about the file. */
  it('refuses a file that carries no signature at all', async () => {
    const verify = jest.fn(async () => ({
      errCode: 'BAD_REQUEST',
      errText: 'file is not a valid CMS signature'
    }))

    expect((await build(verify).vouchFor(submission())).result).toBe(ReceiptLookupResult.UNKNOWN)
  })

  /**
   * Unreachable is not "we do not know this receipt". Recording a refusal for
   * somebody else's downtime would close a top-up whose payout is still payable.
   */
  it('reports an unreachable service as unavailable, never as unknown', async () => {
    const verify = jest.fn(async () => {
      throw new Error('ECONNRESET')
    })

    expect((await build(verify).vouchFor(submission())).result).toBe(
      ReceiptLookupResult.UNAVAILABLE
    )
  })

  /**
   * The signature has already proven the document. Failing to read *our own*
   * side of it is our problem, and it goes to an operator rather than being
   * recorded against the user.
   */
  it('reports a layout it cannot read as unavailable, never as unknown', async () => {
    const result = await build(jest.fn(async () => answer())).vouchFor(
      submission({ text: 'nothing this build recognises' })
    )

    expect(result.result).toBe(ReceiptLookupResult.UNAVAILABLE)
  })

  it('answers for monobank and nothing else', async () => {
    const service = build(jest.fn(async () => answer()))

    expect(service.supports(BankProvider.MONO)).toBe(true)
    expect(service.supports(BankProvider.PRIVAT)).toBe(false)
  })
})

describe('MonobankSignatureAdapterService — reading the document', () => {
  /** The facade already read it when the code did not come from the filename. */
  it('reuses text the facade already extracted', async () => {
    const checker = {
      isConfigured: true,
      extractText: jest.fn()
    } as unknown as ReceiptCheckerApiService

    const service = new MonobankSignatureAdapterService(
      { verify: jest.fn(async () => answer()) } as unknown as MonobankCaApiService,
      checker
    )

    await service.vouchFor(submission())

    expect(checker.extractText).not.toHaveBeenCalled()
  })

  /** And extracts when it did — a filename match skips extraction entirely. */
  it('extracts the document when no text was read', async () => {
    const extractText = jest.fn(async () => ({ text: TEXT, source: 'PDF_TEXT' }))
    const service = new MonobankSignatureAdapterService(
      { verify: jest.fn(async () => answer()) } as unknown as MonobankCaApiService,
      { isConfigured: true, extractText } as unknown as ReceiptCheckerApiService
    )

    const result = await service.vouchFor(submission({ text: null }))

    expect(extractText).toHaveBeenCalledWith(DOCUMENT)
    expect(result.result).toBe(ReceiptLookupResult.FOUND)
  })
})
