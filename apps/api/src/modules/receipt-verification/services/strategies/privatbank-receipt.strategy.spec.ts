import { BankProvider } from '@transacto/contracts'
import { MonobankReceiptStrategy } from './monobank-receipt.strategy'
import { PrivatbankReceiptStrategy } from './privatbank-receipt.strategy'

const CODE = 'P24A0000000000A0000'

describe('PrivatbankReceiptStrategy', () => {
  const strategy = new PrivatbankReceiptStrategy()

  it('answers for PrivatBank', () => {
    expect(strategy.bank).toBe(BankProvider.PRIVAT)
  })

  /** Their download is named `receipt-<code>.pdf`, so this is the ordinary case. */
  it('reads the code PrivatBank names its downloads after', () => {
    expect(strategy.findCodeInFileName(`receipt-${CODE}.pdf`)).toBe(CODE)
  })

  it('survives a browser disambiguating a repeated download', () => {
    expect(strategy.findCodeInFileName(`receipt-${CODE} (1).pdf`)).toBe(CODE)
  })

  it('tolerates a phone re-saving the file in another case', () => {
    expect(strategy.findCodeInFileName(`receipt-${CODE.toLowerCase()}.pdf`)).toBe(CODE)
  })

  it('reads the code as it is printed on the receipt', () => {
    expect(strategy.findCodeInText(`Код документа ${CODE} Підпис платника`)).toBe(CODE)
  })

  it.each([
    ['a card number', 'Рахунок отримувача 4441110000005500'],
    ['an IBAN', 'Рахунок платника UA780000000000000000000000004'],
    ['a truncated code', 'P24A637278098'],
    ['a longer run', `${CODE}EXTRA`],
    ['nothing at all', '']
  ])('finds nothing in %s', (_name, text) => {
    expect(strategy.findCodeInText(text)).toBeNull()
  })

  /** No global-flag state carried between calls — the classic regex bug. */
  it('gives the same answer twice', () => {
    expect(strategy.findCodeInText(CODE)).toBe(strategy.findCodeInText(CODE))
  })
})

/**
 * The property the facade relies on when it asks strategies in order and takes
 * the first answer: "first" has to mean "the only one that matched".
 *
 * A monobank code is sixteen alphanumerics with no prefix; a PrivatBank one is
 * `P24` and sixteen more. If either ever accepted the other's codes, a receipt
 * would be looked up at the wrong service under the wrong identifier and come
 * back as "no such receipt" — a genuine payment, refused, with nothing in the
 * log to say why.
 */
describe('the two strategies never claim each other codes', () => {
  const monobank = new MonobankReceiptStrategy()
  const privatbank = new PrivatbankReceiptStrategy()

  const MONO_CODE = '297X-351K-C1T2-BKMB'

  it('PrivatBank does not answer for a monobank code', () => {
    expect(privatbank.findCodeInText(MONO_CODE)).toBeNull()
    expect(privatbank.findCodeInFileName('297X351KC1T2BKMB.pdf')).toBeNull()
  })

  it('monobank does not answer for a PrivatBank code', () => {
    expect(monobank.findCodeInText(CODE)).toBeNull()
    expect(monobank.findCodeInFileName(`receipt-${CODE}.pdf`)).toBeNull()
  })
})
