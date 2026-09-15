import { PrivatbankRecipientKind } from 'src/shared/interfaces'
import { parsePrivatbankReceipt } from './privatbank-receipt.util'

/**
 * The text a real PrivatBank receipt yields, verbatim.
 *
 * Captured 2026-09-07 by putting the PDF that `privatbank.ua/pb/get-doc` served
 * through the same extractor the product uses, so this is what the parser
 * actually meets — flattened, single-spaced, in reading order — and not a
 * tidied version of it.
 */
const REAL_RECEIPT =
  'P24A0000000000A0000 вул. Грушевського, 1Д, м. Київ, 01001, Україна Тел.: 3700 ' +
  'E-mail: help@privatbank.ua Платіжна інструкція Код документа P24A0000000000A0000 ' +
  'Підпис платника/ініціатора Дата складання 04/09/2026 10:18 2026/09/04 10:18 ' +
  'Петренко Іван Іванович Дата виконання 04/09/2026 10:18 Дата валютування 04/09/2026' +
  'Підписано з використанням електронного підпису Підпис надавача платіжних послуг ' +
  'Щоб переглянути цей документ в електронній формі 1. Зайдіть на сторінку pb.ua/check ' +
  '2. Оберіть тип документа Платіжна інструкція 3. Введіть код платіжної інструкції та ' +
  'натисніть «Знайти» Платник Отримувач Код платника Код отримувача 3000000000 - ' +
  'Рахунок отримувача 4441110000005500 Надавач платіжних послуг отримувача ' +
  'JSC UNIVERSAL BANK Рахунок платника UA780000000000000000000000004 ' +
  'Надавач платіжних послуг платника АТ КБ ПРИВАТБАНК Платіж Комісія Сума 15,00 500,00 ' +
  "Сума словами П'ятсот грн 00 коп. Призначення платежу Переказ власних коштів. " +
  'ПЕТРЕНКО ІВАН ІВАНОВИЧ -'

describe('parsePrivatbankReceipt', () => {
  it('reads a real receipt', () => {
    expect(parsePrivatbankReceipt(REAL_RECEIPT)).toEqual({
      amountUah: 50_000,
      // 10:18 in Kyiv, which was UTC+3 that day.
      paidAt: new Date('2026-09-04T07:18:00Z'),
      recipient: { kind: PrivatbankRecipientKind.CARD, card: '4441110000005500' }
    })
  })

  /**
   * The misreading that would matter. Their table renders the fee first, so a
   * parser taking the first number on the line settles a ₴500 payout against a
   * ₴15 fee — and the receipt is genuine, so nothing else would catch it.
   */
  it('takes the sum and never the fee beside it', () => {
    expect(parsePrivatbankReceipt(REAL_RECEIPT)?.amountUah).not.toBe(1_500)
  })

  it('reads a receipt rendered without a fee column', () => {
    const noFee = REAL_RECEIPT.replace('Комісія Сума 15,00 500,00', 'Сума 500,00')

    expect(parsePrivatbankReceipt(noFee)?.amountUah).toBe(50_000)
  })

  it('reads a sum whose thousands are spaced', () => {
    const large = REAL_RECEIPT.replace('15,00 500,00', '15,00 12 345,67')

    expect(parsePrivatbankReceipt(large)?.amountUah).toBe(1_234_567)
  })

  /**
   * Winter time. The same wall clock is an hour further from UTC in January
   * than in September, and on a fifteen-minute pay window that hour is the
   * difference between a receipt inside it and one refused as too early.
   */
  it('reads the clock as Kyiv time in winter too', () => {
    const january = REAL_RECEIPT.replace('Дата виконання 04/09/2026', 'Дата виконання 04/01/2026')

    expect(parsePrivatbankReceipt(january)?.paidAt).toEqual(new Date('2026-01-04T08:18:00Z'))
  })

  /**
   * Every one of these is a refusal upstream. A field this cannot find with
   * certainty must not be completed by anything — a default, a zero, or the
   * expectation itself all turn the check into a formality.
   */
  it.each([
    ['the execution date', 'Дата виконання 04/09/2026 10:18', 'Дата виконання'],
    ['the recipient account', 'Рахунок отримувача 4441110000005500', 'Рахунок'],
    ['the amounts', 'Комісія Сума 15,00 500,00', 'Комісія Сума']
  ])('refuses a receipt missing %s', (_name, present, replacement) => {
    expect(parsePrivatbankReceipt(REAL_RECEIPT.replace(present, replacement))).toBeNull()
  })

  /**
   * PrivatBank prints an IBAN here when the money went to an account rather
   * than a card, and an IBAN cannot be compared with the card a Transacto
   * payout names.
   */
  /**
   * **An IBAN is a successful read.** PrivatBank prints one on every transfer
   * that stays inside PrivatBank, which is an ordinary thing for a user to do.
   * Reporting it as unparseable would log "their layout has changed" on a
   * routine receipt and cry wolf until nobody read the line; whether it can
   * settle a payout is the matching rules' question, and they refuse it by name.
   */
  it('reads a recipient that is an account rather than a card', () => {
    const iban = REAL_RECEIPT.replace(
      'Рахунок отримувача 4441110000005500',
      'Рахунок отримувача UA780000000000000000000000004'
    )

    expect(parsePrivatbankReceipt(iban)?.recipient).toEqual({
      kind: PrivatbankRecipientKind.IBAN,
      iban: 'UA780000000000000000000000004'
    })
  })

  it('refuses a recipient that is neither', () => {
    const nonsense = REAL_RECEIPT.replace(
      'Рахунок отримувача 4441110000005500',
      'Рахунок отримувача 12345'
    )

    expect(parsePrivatbankReceipt(nonsense)).toBeNull()
  })

  it('refuses an empty document', () => {
    expect(parsePrivatbankReceipt('')).toBeNull()
  })
})

/**
 * All four receipts captured from this account, parsed as they actually arrive.
 *
 * They cover the split that matters and that a single sample hid entirely:
 * **PrivatBank names the recipient's card when the money leaves PrivatBank and
 * their IBAN when it does not**, and it prints the recipient's name in exactly
 * the opposite cases. Two of these can be matched against a payout's card and
 * two cannot, which is a product decision rather than a parsing failure — so
 * what is asserted here is that all four are read correctly, not that all four
 * are acceptable.
 *
 * They also span a daylight-saving boundary: June and September are both EEST,
 * so the winter case is exercised separately above.
 */
describe('parsePrivatbankReceipt — every captured receipt', () => {
  const receipt = (
    code: string,
    executedAt: string,
    fee: string,
    sum: string,
    account: string
  ): string =>
    `${code} вул. Грушевського, 1Д, м. Київ, 01001, Україна Тел.: 3700 ` +
    `E-mail: help@privatbank.ua Платіжна інструкція Код документа ${code} ` +
    `Підпис платника/ініціатора Дата складання ${executedAt} ` +
    `Петренко Іван Іванович Дата виконання ${executedAt} Дата валютування ` +
    'Підписано з використанням електронного підпису Платник Отримувач ' +
    `Код платника Код отримувача 3000000000 - Рахунок отримувача ${account} ` +
    'Надавач платіжних послуг отримувача Рахунок платника ' +
    `UA780000000000000000000000004 Платіж Комісія Сума ${fee} ${sum} Сума словами`

  it.each([
    [
      'P24A0000000000A0000',
      receipt('P24A0000000000A0000', '04/09/2026 10:18', '15,00', '500,00', '4441110000005500'),
      50_000,
      '2026-09-04T07:18:00Z',
      PrivatbankRecipientKind.CARD
    ],
    [
      'P24A0000000003A0003',
      receipt('P24A0000000003A0003', '02/09/2026 16:58', '9,00', '300,00', '4441110000006102'),
      30_000,
      '2026-09-02T13:58:00Z',
      PrivatbankRecipientKind.CARD
    ],
    [
      'P24A0000000001A0001',
      receipt(
        'P24A0000000001A0001',
        '14/06/2026 13:36',
        '15,08',
        '502,51',
        'UA620000000000000000000000001'
      ),
      50_251,
      '2026-06-14T10:36:00Z',
      PrivatbankRecipientKind.IBAN
    ],
    [
      'P24A0000000002A0002',
      receipt(
        'P24A0000000002A0002',
        '15/06/2026 11:44',
        '10,55',
        '351,76',
        'UA080000000000000000000000003'
      ),
      35_176,
      '2026-06-15T08:44:00Z',
      PrivatbankRecipientKind.IBAN
    ]
  ])('reads %s', (_code, text, amountUah, paidAt, recipientKind) => {
    const parsed = parsePrivatbankReceipt(text)

    expect(parsed?.amountUah).toBe(amountUah)
    expect(parsed?.paidAt).toEqual(new Date(paidAt))
    expect(parsed?.recipient.kind).toBe(recipientKind)
  })

  /**
   * The fee is a different number on every one of them, and on two it is close
   * enough to a plausible top-up to be worth stating: nothing here may ever
   * settle a payout against ₴15,08.
   */
  it.each([
    ['15,00', '500,00', 50_000],
    ['9,00', '300,00', 30_000],
    ['15,08', '502,51', 50_251],
    ['10,55', '351,76', 35_176]
  ])('takes %s as the fee and %s as the sum', (fee, sum, expected) => {
    const text = receipt('P24A0000000000A0000', '04/09/2026 10:18', fee, sum, '4441110000005500')

    expect(parsePrivatbankReceipt(text)?.amountUah).toBe(expected)
  })
})
