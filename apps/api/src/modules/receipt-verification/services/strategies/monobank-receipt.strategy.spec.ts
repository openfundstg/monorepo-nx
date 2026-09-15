import { BankProvider } from '@transacto/contracts'
import { MonobankReceiptStrategy } from './monobank-receipt.strategy'

describe('MonobankReceiptStrategy', () => {
  const strategy = new MonobankReceiptStrategy()

  it('answers for monobank', () => {
    expect(strategy.bank).toBe(BankProvider.MONO)
  })

  describe('from the file name', () => {
    /**
     * The ordinary case, and the reason the file name is read first: monobank
     * serves its own receipt as `297X351KC1T2BKMB.pdf`, so nothing has to be
     * recognised for the code to be right.
     */
    it('reads the code monobank names its downloads after', () => {
      expect(strategy.findCodeInFileName('297X351KC1T2BKMB.pdf')).toBe('297X-351K-C1T2-BKMB')
    })

    it('tolerates a phone re-saving the file in another case', () => {
      expect(strategy.findCodeInFileName('297x351kc1t2bkmb.pdf')).toBe('297X-351K-C1T2-BKMB')
    })

    it.each([
      ['a screenshot', 'IMG_20260906_110645.png'],
      ['a shared file', 'Документ від 06.09.2026.pdf'],
      ['a bare card number', '4441118888888671.pdf']
    ])('finds nothing in %s', (_name, fileName) => {
      expect(strategy.findCodeInFileName(fileName)).toBeNull()
    })
  })

  describe('from the text', () => {
    it('reads the code as it is printed', () => {
      const text = 'Квитанція №297X-351K-C1T2-BKMB від 06.09.2026'

      expect(strategy.findCodeInText(text)).toBe('297X-351K-C1T2-BKMB')
    })

    /**
     * A receipt prints its code in groups, and both a PDF's text layer and an
     * optical read are entitled to put a line break inside it.
     */
    it('reads a code a layout broke across a line', () => {
      expect(strategy.findCodeInText('код 297X-351K- C1T2-BKMB')).toBe('297X-351K-C1T2-BKMB')
    })

    it('reads an undashed code out of running text', () => {
      expect(strategy.findCodeInText('Receipt 297X351KC1T2BKMB signed')).toBe(
        '297X-351K-C1T2-BKMB'
      )
    })

    /**
     * The check that keeps a bank card out. A receipt is full of
     * sixteen-character runs of digits, and every one of them would otherwise be
     * looked up as a receipt code.
     */
    it('never reads sixteen digits as a code', () => {
      expect(strategy.findCodeInText('Карта одержувача 4441118888888671')).toBeNull()
    })

    /**
     * PrivatBank's codes are sixteen digits (their own `js/index.js` declares
     * `isDigits: true`), so this is not merely a card-number guard — it is what
     * stops one bank's codes being looked up under the other's name.
     */
    it('leaves a PrivatBank-shaped code alone', () => {
      expect(strategy.findCodeInText('1234-5678-9012-3456')).toBeNull()
    })

    it.each([
      ['a longer run', 'ABCD1234ABCD1234X'],
      ['a shorter run', '297X-351K-C1T2'],
      ['nothing at all', '']
    ])('finds nothing in %s', (_name, text) => {
      expect(strategy.findCodeInText(text)).toBeNull()
    })

    /** No global-flag state carried between calls — the classic regex bug. */
    it('gives the same answer twice', () => {
      const text = 'Receipt 297X351KC1T2BKMB'

      expect(strategy.findCodeInText(text)).toBe(strategy.findCodeInText(text))
    })
  })
})
