import { BankProvider } from '@transacto/contracts'
import {
  AttestedDocumentKind,
  ReceiptLookupResult,
  ReceiptTextSource,
  ReceiptVerificationOutcome
} from '../enums'
import type {
  AttestedReceipt,
  ReceiptCodeStrategy,
  ReceiptExpectation,
  ReceiptVerificationProvider
} from '../interfaces'
import { ReceiptVerificationFacadeService } from './receipt-verification.facade.service'
import type { ReceiptCheckerApiService } from './receipt-checker.api.service'

const CODE = 'P24A0000000000A0000'
const PAYOUT_CARD = '4441110000005500'
const RESERVED_AT = new Date('2026-09-04T07:00:00Z')
const DEADLINE_AT = new Date('2026-09-04T07:15:00Z')

const expectation = (overrides: Partial<ReceiptExpectation> = {}): ReceiptExpectation => ({
  amountUah: 50_000,
  recipientCard: PAYOUT_CARD,
  paidNotBefore: RESERVED_AT,
  paidNotAfter: DEADLINE_AT,
  ...overrides
})

const attested = (overrides: Partial<AttestedReceipt> = {}): AttestedReceipt => ({
  bank: BankProvider.PRIVAT,
  code: CODE,
  amountUah: 50_000,
  paidAt: new Date('2026-09-04T07:05:00Z'),
  currencyCode: 980,
  recipient: PAYOUT_CARD,
  document: { kind: AttestedDocumentKind.FILE, file: { buffer: Buffer.alloc(0), fileName: 'r.pdf', mimeType: 'application/pdf' } },
  ...overrides
})

const build = (receipt: AttestedReceipt): ReceiptVerificationFacadeService => {
  const strategy: ReceiptCodeStrategy = {
    bank: BankProvider.PRIVAT,
    findCodeInFileName: () => CODE,
    findCodeInText: () => CODE
  }
  const provider: ReceiptVerificationProvider = {
    name: 'stub',
    supports: () => true,
    vouchFor: async () => ({ result: ReceiptLookupResult.FOUND, receipt })
  }

  return new ReceiptVerificationFacadeService(
    { isConfigured: true, extractText: async () => ({ text: '', source: ReceiptTextSource.PDF_TEXT }) } as unknown as ReceiptCheckerApiService,
    [strategy],
    [provider]
  )
}

const verify = (receipt: AttestedReceipt, against = expectation()) =>
  build(receipt).verify({ buffer: Buffer.alloc(0), fileName: 'r.pdf', mimeType: 'application/pdf' }, against)

/**
 * The one deliberate weakening in the whole verification path, and the tests
 * that keep it narrow.
 *
 * A PrivatBank transfer that stayed inside PrivatBank names the recipient's
 * IBAN rather than a card, and Transacto leaves `recipient_name` empty on its
 * payouts — so the recipient check has nothing to compare and does not run. The
 * receipt still goes upstream, on the strength of the other three.
 *
 * **It must never widen.** The moment anything else disagrees, this is an
 * ordinary mismatch: a receipt that is already wrong about the sum has not
 * earned the benefit of the doubt about who was paid.
 */
describe('ReceiptVerificationFacadeService — an uncheckable recipient', () => {
  const IBAN = 'UA620000000000000000000000001'

  it('verifies everything else and says the recipient was not checked', async () => {
    const result = await verify(attested({ recipient: IBAN }))

    expect(result.outcome).toBe(ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT)
  })

  it('is still the full verdict when the recipient is a comparable card', async () => {
    const result = await verify(attested())

    expect(result.outcome).toBe(ReceiptVerificationOutcome.VERIFIED)
  })

  it.each([
    ['the sum is wrong', { recipient: IBAN, amountUah: 49_999 }],
    ['the currency is wrong', { recipient: IBAN, currencyCode: 840 }],
    ['it was paid before the payout existed', { recipient: IBAN, paidAt: new Date('2026-09-04T06:00:00Z') }],
    ['it was paid after the window closed', { recipient: IBAN, paidAt: new Date('2026-09-04T08:00:00Z') }]
  ])('refuses outright when %s as well', async (_name, overrides) => {
    const result = await verify(attested(overrides))

    expect(result.outcome).toBe(ReceiptVerificationOutcome.MISMATCHED)
  })

  /**
   * A recipient that is neither a card nor an account is a rendering nobody has
   * seen. That is a parser to look at, not a receipt to wave through.
   */
  it('refuses a recipient it simply could not read', async () => {
    const result = await verify(attested({ recipient: 'Ілля К.' }))

    expect(result.outcome).toBe(ReceiptVerificationOutcome.MISMATCHED)
  })
})
