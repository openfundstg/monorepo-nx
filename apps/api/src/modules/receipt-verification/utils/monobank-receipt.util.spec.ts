import { monobankReceiptGaps, parseMonobankReceipt } from './monobank-receipt.util'

/**
 * The real layout, captured 2026-09-08 from a receipt's text layer, with both
 * card numbers replaced. Everything else — the labels, their order, the spacing
 * — is exactly what the extractor produced.
 */
const RECEIPT =
  'АТ «УНІВЕРСАЛ БАНК» Телефон: 0 800 205 205 Адреса: 04080, м.Київ, вул. Оленівська, 23 ' +
  'Ліцензія НБУ на право надання банківських послуг №92 від 20.01.1994 р. . ' +
  'Квитанція № 6K4A-0000-0000-0000 від 08.09.2026 ' +
  "Відправник Ім'я Петренко Петро Іванович Банк Універсал Банк Код банку 322001 " +
  'Платіжна система VISA Платіжний інструмент UA510000000000000000000000005, 4441 1111 1111 1111 ' +
  "Одержувач Ім'я Михайло М. Банк одержувач Універсал Банк Платіжна система VISA " +
  'Платіжний інструмент 5375414122223333 ' +
  'Деталі транзакції Сума (грн) 1 100.00 Комісія (грн) 0.00 ' +
  'Сума літерами одна тисяча сто гривень 00 копійок Код авторизації 191115 ' +
  'Призначення платежу Переказ особистих коштів ' +
  'Дата і час операції 08.09.2026 15:15 Ідентифікатор платіжного пристрою: MONODi'

describe('parseMonobankReceipt — the captured layout', () => {
  const parsed = parseMonobankReceipt(RECEIPT)

  it('reads all four facts', () => {
    expect(parsed).not.toBeNull()
  })

  it('takes the sum and not the fee beside it', () => {
    expect(parsed?.amountUah).toBe(110000)
  })

  /**
   * The document carries `Платіжний інструмент` twice — the payer's above and
   * the recipient's below. An unanchored read takes the payer's, which would
   * compare the sender's card against the payout's and refuse every genuine
   * receipt.
   */
  it("takes the recipient's card and not the sender's", () => {
    expect(parsed?.recipientCard).toBe('5375414122223333')
  })

  /** `15:15` in Kyiv is `12:15Z` in September — the offset is not assumed. */
  it('reads the Kyiv wall clock as an instant', () => {
    expect(parsed?.paidAt.toISOString()).toBe('2026-09-08T12:15:00.000Z')
  })

  /**
   * The code may otherwise arrive from the file's own name, which a user can
   * rename. What the proven document calls itself is what gets recorded.
   */
  it('reads the number the document prints', () => {
    expect(parsed?.code).toBe('6K4A-0000-0000-0000')
  })
})

describe('parseMonobankReceipt — refusing rather than guessing', () => {
  const without = (label: string): string => RECEIPT.replace(label, 'Видалено')

  it.each([
    ['the sum', 'Сума (грн)'],
    ['the date', 'Дата і час операції'],
    ['the recipient', 'Банк одержувач'],
    ['the number', 'Квитанція №']
  ])('refuses a document missing %s', (_name, label) => {
    expect(parseMonobankReceipt(without(label))).toBeNull()
  })

  it('refuses an empty document', () => {
    expect(parseMonobankReceipt('')).toBeNull()
  })

  /**
   * The sum in words sits two labels after the figure and contains no digits
   * this could take — but a looser anchor than `(грн)` would reach it, and a
   * receipt settled against nothing is worse than one refused.
   */
  it('never reads the sum written out in words', () => {
    const worded = RECEIPT.replace('Сума (грн) 1 100.00', 'Сума 1 100.00')

    expect(parseMonobankReceipt(worded)).toBeNull()
  })

  /** A recipient whose card is not sixteen digits cannot be compared. */
  it('refuses a recipient card of the wrong length', () => {
    const short = RECEIPT.replace('5375414122223333', '53754141222')

    expect(parseMonobankReceipt(short)).toBeNull()
  })

  /** A comma is unambiguous even though this bank renders a point. */
  it('accepts either decimal separator', () => {
    expect(parseMonobankReceipt(RECEIPT.replace('1 100.00', '1 100,00'))?.amountUah).toBe(110000)
  })
})

/**
 * **"The layout could not be read" is not a diagnosis.**
 *
 * A genuine receipt failed to parse in production and the log named all three
 * fields whether or not each was the problem, so the only way to learn which
 * label had moved was to obtain the document. These gaps are what the log
 * prints instead — labels, never the values behind them.
 */
describe('monobankReceiptGaps', () => {
  it('finds nothing missing in a receipt that parses', () => {
    expect(monobankReceiptGaps(RECEIPT)).toEqual([])
  })

  it.each([
    ['Сума (грн)', 'Сума (грн)'],
    ['Дата і час операції', 'Дата і час операції'],
    ['Квитанція №', 'Квитанція №']
  ])('names «%s» when that label is gone', (_name, label) => {
    const gaps = monobankReceiptGaps(RECEIPT.replace(label, 'Видалено'))

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain(label)
  })

  it('names the recipient anchor when the recipient block is gone', () => {
    const gaps = monobankReceiptGaps(RECEIPT.replace('Банк одержувач', 'Видалено'))

    expect(gaps).toEqual(['«Одержувач … Банк одержувач … Платіжний інструмент»'])
  })

  /** Every label at once is what a wholly different document looks like. */
  it('names all four for text that is not a receipt', () => {
    expect(monobankReceiptGaps('nothing here')).toHaveLength(4)
  })

  /** A label is theirs; what it points at is somebody's payment credential. */
  it('never carries a value out with it', () => {
    const printed = monobankReceiptGaps('nothing here').join(' ')

    expect(printed).not.toMatch(/\d{4}/)
  })
})

/**
 * **The layout that broke it in production.**
 *
 * Monobank prints the recipient's `Ім'я` only when the recipient is one of
 * theirs. A transfer out to another bank has no name at all — the block reads
 * `Одержувач Банк одержувач ПриватБанк` — and anchoring on `Одержувач Ім'я`
 * therefore failed every outbound transfer. A genuine ₴1 000 top-up verified
 * its signature, could not be read, and went to an operator.
 *
 * Captured 2026-09-08 from receipt `2H4K-6071-ABA9-20T8`, values replaced.
 */
const OUTBOUND =
  'АТ «УНІВЕРСАЛ БАНК» Телефон: 0 800 205 205 ' +
  'Квитанція № 2H4K-6071-ABA9-20T8 від 08.09.2026 ' +
  "Відправник Ім'я Петренко Петро Іванович Банк Універсал Банк Код банку 322001 " +
  'Платіжна система VISA Платіжний інструмент UA510000000000000000000000005, 444111******9718 ' +
  'Одержувач Банк одержувач ПриватБанк Платіжна система VISA ' +
  'Платіжний інструмент 5168750000007416 ' +
  'Деталі транзакції Сума (грн) 1 005.00 Комісія (грн) 0.00 ' +
  'Сума літерами одна тисяча п’ять гривень 00 копійок Код авторизації 191115 ' +
  'Призначення платежу Переказ особистих коштів ' +
  'Дата і час операції 08.09.2026 23:43 Ідентифікатор платіжного пристрою: MONODirectR'

describe('parseMonobankReceipt — a transfer out to another bank', () => {
  const parsed = parseMonobankReceipt(OUTBOUND)

  it('reads it even though the recipient has no name', () => {
    expect(parsed).not.toBeNull()
  })

  /**
   * The payer's own card is masked on this very receipt, two labels above the
   * recipient's. Taking it would compare the sender against the payout.
   */
  it("takes the recipient's card and not the payer's masked one", () => {
    expect(parsed?.recipientCard).toBe('5168750000007416')
  })

  it('reads the sum past the fee', () => {
    expect(parsed?.amountUah).toBe(100500)
  })

  it('reports nothing missing', () => {
    expect(monobankReceiptGaps(OUTBOUND)).toEqual([])
  })
})

/**
 * A masked recipient has not been seen, but the payer's is masked on every
 * receipt captured — so the day it happens is not the day to rediscover that
 * `matchesMaskedCard` already compares them.
 */
describe('parseMonobankReceipt — a masked recipient', () => {
  it('accepts one and hands it on for comparison', () => {
    const masked = OUTBOUND.replace('5168750000007416', '516875******7416')

    expect(parseMonobankReceipt(masked)?.recipientCard).toBe('516875******7416')
  })
})
