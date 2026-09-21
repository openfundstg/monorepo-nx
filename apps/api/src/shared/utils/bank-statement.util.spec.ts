import { BankProvider } from '@transacto/contracts'
import {
  canReadStatement,
  parseStatement,
  readAmount,
  readStatementNumber
} from './bank-statement.util'

/**
 * Every document below is **invented to the captured structure**, never a real
 * one: no repository of this product holds somebody's transaction history, a
 * card of theirs or their name. See the root `CLAUDE.md`.
 *
 * The shapes they imitate — labels, separators, column order, the page header
 * that looks like a row — are recorded in
 * `shared/interfaces/bank-statement.interface.ts`, captured on 2026-09-17 from
 * one statement of each bank.
 *
 * They are written as the text `apps/receipt-checker` actually returns: one
 * line, every run of whitespace collapsed to a single space. That is the only
 * form this parser ever sees, and building the fixtures any other way would
 * test a document that does not exist.
 */

const NAME = 'Петренко Роман Іванович'

/** Invented, and not a card: only the last four digits are ever read. */
const MONO_MASK = '5375 **** **** 4321'
const PRIVAT_MASK = '537541******4321'

/** All zeros: unmistakably invented, and unable to collide with a real one. */
const IBAN = 'UA000000000000000000000000000'

const monoRow = (
  date: string,
  time: string,
  cardAmount: string,
  balance = '2 076.00'
): string => `${date} ${time} Від: Ivan Petrenko 4829 ${cardAmount} ${cardAmount} UAH — 0.00 0.00 ${balance}`

const monoStatement = (
  options: {
    rows?: readonly string[]
    period?: string
    totalCredited?: string
    owner?: string
    card?: string
  } = {}
): string =>
  [
    'АТ «УНІВЕРСАЛ БАНК» Рух коштів по картці від 17.09.2026р.',
    `Клієнт: ${options.owner ?? NAME}`,
    'Дата народження: 01.01.1990 ІПН: 0000000000',
    `Інформація по картці: ${options.card ?? MONO_MASK}`,
    `Рахунок: ${IBAN}`,
    `Період: ${options.period ?? '13.09.2026 - 17.09.2026'}`,
    'Баланс на початок періоду: 0.00 UAH',
    'Сума витрат за період: 0.00 UAH',
    `Сума зарахувань за період: ${options.totalCredited ?? '1 470.00'} UAH`,
    'Дата i час операції Деталі операції MCC Сума в валюті картки (UAH) Сума в валюті операції Валюта Курс Сума комісій (UAH) Сума кешбеку/ миль Залишок після операції',
    ...(options.rows ?? [monoRow('14.09.2026', '14:12:03', '1 470.00')]),
    'Операційний директор Документ підписано електронним цифровим підписом.'
  ].join(' ')

/**
 * One PrivatBank row.
 *
 * `balance: null` is the shorter statement Privat24 also issues — «без
 * відображення залишків» — where every row ends one column early. It is not a
 * truncated row: the whole document is written that way, and the column heading
 * says so.
 */
const privatRow = (
  date: string,
  time: string,
  cardAmount: string,
  balance: string | null = '-12 345,67'
): string =>
  `${date} ${time} ${PRIVAT_MASK}Угода № SAMD00000000000 від 01.01.2024 р. ` +
  `Переказ, УКРАЇНА, документ № 0000000000000000, Коментар до платежу: - ` +
  `${cardAmount} UAH ${cardAmount} 0,00 0,00${balance === null ? '' : ` ${balance}`}`

/**
 * Invented to the captured shape: sixteen uppercase letters and digits, with no
 * fixed prefix. A real one resolves at `pb.ua/check` to a real person's
 * statement, which is why none is written down anywhere in this repository.
 */
const PRIVAT_NUMBER = 'QB00ABCDEFGH0000'

/** The footer PrivatBank repeats on every page — it begins exactly like a row. */
const privatPageFooter = (page: number, number = PRIVAT_NUMBER): string =>
  `17.09.2026 12:20 № ${number} Сторінка ${page} з 11`

/** The column heading whose presence declares the running-balance column. */
const RUNNING_BALANCE_HEADING = 'Залишок після операції'

const privatStatement = (
  options: {
    rows?: readonly string[]
    period?: string
    totalCredited?: string
    pages?: number
    number?: string
    /** `false` for the shorter statement, which drops the last column. */
    runningBalance?: boolean
  } = {}
): string =>
  [
    'АКЦІОНЕРНЕ ТОВАРИСТВО КОМЕРЦІЙНИЙ БАНК «ПриватБанк»',
    `Усього надходжень: ${options.totalCredited ?? '1 428,00'}`,
    `Власник рахунку: ${NAME}`,
    'Дата народження: 01.01.1990 РНОКПП: 0000000000',
    `Інформація по картці: ${PRIVAT_MASK}`,
    `Рахунок IBAN: ${IBAN}`,
    `Період: ${options.period ?? '31.07.2026 — 31.08.2026'}`,
    ...(options.runningBalance === false
      ? ['Довідка містить тільки інформацію про рух коштів без відображення залишків по картці/рахунку.']
      : []),
    'Дата операції Картка / Рахунок Деталі операції Сума у валюті операції ' +
      'Сума у валюті картки Сума комісій Сума знижок' +
      (options.runningBalance === false ? '' : ` ${RUNNING_BALANCE_HEADING}`),
    ...(options.rows ??
      [
        privatRow(
          '14.08.2026',
          '14:12',
          '1 428,00',
          options.runningBalance === false ? null : undefined
        )
      ]),
    ...Array.from({ length: options.pages ?? 1 }, (_, index) =>
      privatPageFooter(index + 1, options.number)
    )
  ].join(' ')

describe('readAmount', () => {
  /**
   * Integer arithmetic throughout. `Number('1470.00') * 100` is inexact for
   * some two-decimal values, and the error lands in somebody's transfer — the
   * same reason `panelAmountToKopecks` counts digit groups.
   */
  it('reads both dialects into kopecks', () => {
    expect(readAmount('1 470.00', '.')).toBe(147_000)
    expect(readAmount('1 428,00', ',')).toBe(142_800)
  })

  /** The sign is the only thing that tells a credit from a debit. */
  it('keeps the sign', () => {
    expect(readAmount('-1 470.00', '.')).toBe(-147_000)
    expect(readAmount('-1 428,00', ',')).toBe(-142_800)
  })

  /** A non-breaking space groups thousands in the source document. */
  it('reads a non-breaking space as grouping', () => {
    expect(readAmount('1\u00a0470.00', '.')).toBe(147_000)
  })

  it('refuses the other bank’s separator rather than misreading it', () => {
    expect(readAmount('1 470,00', '.')).toBeNull()
    expect(readAmount('1 428.00', ',')).toBeNull()
  })

  it.each(['', ' ', '1470', 'abc', '1.234', '1.2', null])('refuses %p', (raw) => {
    expect(readAmount(raw, '.')).toBeNull()
  })
})

describe('canReadStatement', () => {
  /**
   * A bank with no dialect is refused rather than read by somebody else's. The
   * card variant is only offered on banks that appear here — see
   * `CARD_SALE_ENABLED_BANKS`.
   */
  it.each([BankProvider.MONO, BankProvider.PRIVAT])('reads %s', (bank) => {
    expect(canReadStatement(bank)).toBe(true)
  })

  it.each([BankProvider.PUMB, BankProvider.NOVAPAY])('does not read %s', (bank) => {
    expect(canReadStatement(bank)).toBe(false)
  })
})

describe('parseStatement — monobank', () => {
  const parse = (text: string) => parseStatement(text, BankProvider.MONO)

  it('reads the header a verdict rests on', () => {
    const parsed = parse(monoStatement())

    expect(parsed).toMatchObject({
      bank: BankProvider.MONO,
      ownerName: NAME,
      cardTail: '4321',
      iban: IBAN,
      unreadableRows: 0,
      creditsReconciled: true
    })
  })

  /**
   * The period is two dates with no times, so the later one runs to the end of
   * its day. Taken literally it would declare every statement short of its own
   * final day and refuse every dispute raised on the day it was pulled.
   */
  it('runs the period to the end of its last day', () => {
    const parsed = parse(monoStatement())

    expect(parsed?.periodFrom.toISOString()).toBe('2026-09-12T21:00:00.000Z')
    expect(parsed?.periodTo.toISOString()).toBe('2026-09-17T20:59:59.999Z')
  })

  /**
   * **The seconds are part of the moment, and dropping them cost a real sale.**
   *
   * They were discarded, on the reasoning that a minute is finer than anything
   * a statement is compared against. It is not: the window a credit is matched
   * into is bounded by timestamps this process wrote itself, and those have
   * seconds. A ₴300 credit printed at 18:14:20 was read as 18:14:00 against an
   * order recorded at 18:14:04, and a statement that plainly showed the money
   * was reported as showing none.
   */
  it('keeps the seconds a row prints', () => {
    const parsed = parse(monoStatement({ rows: [monoRow('14.09.2026', '12:00:20', '1 470.00')] }))

    expect(parsed?.movements[0]?.at.toISOString()).toBe('2026-09-14T09:00:20.000Z')
  })

  /**
   * The reason the clock goes through `fromKyivWallClock` rather than a fixed
   * offset: Kyiv is UTC+3 in September and UTC+2 in January, and an hour is the
   * difference between a credit inside an order's window and one outside it.
   */
  it('reads the clock as Kyiv time in winter as well as in summer', () => {
    const summer = parse(monoStatement({ rows: [monoRow('14.09.2026', '12:00:00', '1 470.00')] }))
    const winter = parse(
      monoStatement({
        rows: [monoRow('14.01.2026', '12:00:00', '1 470.00')],
        period: '01.01.2026 - 31.01.2026'
      })
    )

    expect(summer?.movements[0].at.toISOString()).toBe('2026-09-14T09:00:00.000Z')
    expect(winter?.movements[0].at.toISOString()).toBe('2026-01-14T10:00:00.000Z')
  })

  it('takes the card-currency amount, which comes first here', () => {
    // A credit of 1 470.00 in the card's currency, funded by 50.00 of something
    // else — the two columns disagree, and only the first is hryvnia.
    const row =
      '14.09.2026 14:12:03 Від: Ivan Petrenko 4829 1 470.00 50.00 USD 29.40 0.00 0.00 2 076.00'
    const parsed = parse(monoStatement({ rows: [row] }))

    expect(parsed?.movements[0].amountKopecks).toBe(147_000)
  })

  it('tells a credit from a debit by its sign', () => {
    const parsed = parse(
      monoStatement({
        rows: [monoRow('13.09.2026', '13:44:21', '-1 470.00'), monoRow('14.09.2026', '14:12:03', '1 470.00')],
        totalCredited: '1 470.00'
      })
    )

    expect(parsed?.movements.map((movement) => movement.amountKopecks)).toEqual([-147_000, 147_000])
  })

  /**
   * The bargain that makes hand-parsing a document acceptable: a row that looks
   * like a row and does not read is **counted**, never skipped. A statement
   * that quietly dropped the one row in question would prove the opposite of
   * what it says.
   */
  it('counts a row it cannot read rather than dropping it', () => {
    const truncated = '15.09.2026 15:00:00 Від: Ivan Petrenko 4829 1 470.00'
    const parsed = parse(
      monoStatement({ rows: [monoRow('14.09.2026', '14:12:03', '1 470.00'), truncated] })
    )

    expect(parsed?.movements).toHaveLength(1)
    expect(parsed?.unreadableRows).toBe(1)
  })
})

describe('parseStatement — PrivatBank', () => {
  const parse = (text: string) => parseStatement(text, BankProvider.PRIVAT)

  it('reads the header a verdict rests on', () => {
    const parsed = parse(privatStatement())

    expect(parsed).toMatchObject({
      bank: BankProvider.PRIVAT,
      ownerName: NAME,
      cardTail: '4321',
      iban: IBAN,
      unreadableRows: 0,
      creditsReconciled: true
    })
  })

  /** An em dash here, a hyphen on monobank. */
  it('reads a period separated by an em dash', () => {
    expect(parse(privatStatement())?.periodFrom.toISOString()).toBe('2026-07-30T21:00:00.000Z')
  })

  it('takes the card-currency amount, which comes after the currency here', () => {
    const row =
      `14.08.2026 14:12 ${PRIVAT_MASK}Угода № SAMD00000000000 від 01.01.2024 р. Переказ ` +
      '50,00 USD 1 428,00 0,00 0,00 -12 345,67'
    const parsed = parse(privatStatement({ rows: [row] }))

    expect(parsed?.movements[0].amountKopecks).toBe(142_800)
  })

  /**
   * **The one that would have refused every real statement.** Every page
   * carries a footer beginning with a date and a time, so it looks exactly like
   * the start of a row. In the captured document there were 83 such anchors:
   * 73 rows and 10 page footers. Counting anchors and subtracting parsed rows
   * would have reported ten unreadable rows on a document read perfectly.
   */
  it('does not mistake a page footer for a row it failed to read', () => {
    const parsed = parse(privatStatement({ pages: 11 }))

    expect(parsed?.movements).toHaveLength(1)
    expect(parsed?.unreadableRows).toBe(0)
  })

  /**
   * **A statement for a single day, which is the commonest one there is.**
   *
   * PrivatBank prints a bare date rather than a range when the period is one
   * day, and reading only ranges refused every such document outright — with
   * `UNREADABLE`, which reads as an accusation about the file. It is what a
   * seller answering a dispute pulls: two of them, for the day the orders
   * arrived, were refused in production on 2026-09-20.
   */
  it('reads a period printed as one date as the whole of that day', () => {
    const parsed = parse(
      privatStatement({
        period: '20.09.2026',
        rows: [privatRow('20.09.2026', '17:52', '1 428,00')]
      })
    )

    expect(parsed?.periodFrom.toISOString()).toBe('2026-09-19T21:00:00.000Z')
    expect(parsed?.periodTo.toISOString()).toBe('2026-09-20T20:59:59.999Z')
  })

  /**
   * A range this build cannot read must refuse, not quietly become its first
   * day. A shorter period still satisfies every check a caller makes — it is
   * simply a document covering less than it says, which is the one thing a
   * statement asked to prove a negative may never be.
   */
  it('refuses a malformed range rather than reading it as a single day', () => {
    expect(parse(privatStatement({ period: '20.09.2026 - 21.9.2026' }))).toBeNull()
  })

  /**
   * **Privat24 issues the same statement with and without a running balance**,
   * and the shorter one drops the last column of every row. Captured
   * 2026-09-21 from two statements of one account pulled minutes apart; the
   * reader could only read the longer, and refused the other as `UNREADABLE`.
   */
  it('reads the shorter statement that carries no running balance', () => {
    const parsed = parse(
      privatStatement({
        runningBalance: false,
        rows: [
          privatRow('20.09.2026', '17:49', '714,00', null),
          privatRow('20.09.2026', '17:52', '714,00', null)
        ],
        totalCredited: '1 428,00'
      })
    )

    expect(parsed?.movements.map((movement) => movement.amountKopecks)).toEqual([71_400, 71_400])
    expect(parsed?.unreadableRows).toBe(0)
    expect(parsed?.creditsReconciled).toBe(true)
  })

  /**
   * **The guard on the shape above, and the reason the heading decides.**
   *
   * The short row pattern is a *prefix* of the full one, so a reader that tried
   * the full pattern and fell back to the short one would read a truncated row
   * as a complete one — and report a misread table as a clean one, which is the
   * single outcome this whole reconciliation exists to prevent. The column's
   * presence is asserted from the heading, so a row that ends early in a
   * document that declares the column is counted unread.
   */
  it('counts a row missing its balance as unread when the column is declared', () => {
    const parsed = parse(
      privatStatement({
        rows: [
          privatRow('14.08.2026', '14:12', '1 428,00'),
          privatRow('15.08.2026', '15:00', '1 428,00', null)
        ]
      })
    )

    expect(parsed?.movements).toHaveLength(1)
    expect(parsed?.unreadableRows).toBe(1)
  })
})

describe('the integrity checks a verdict refuses on', () => {
  /**
   * `apps/receipt-checker` reads at most ten pages, and statements are longer —
   * the captured PrivatBank one has eleven. A dropped page leaves no anchor
   * behind to count, so the document parses cleanly and is simply missing
   * movements. The bank's own period total is the only thing that still
   * disagrees.
   */
  it('notices credits that do not add up to the bank’s own total', () => {
    const parsed = parseStatement(
      monoStatement({
        rows: [monoRow('14.09.2026', '14:12:03', '1 470.00')],
        totalCredited: '2 940.00'
      }),
      BankProvider.MONO
    )

    expect(parsed?.creditsReconciled).toBe(false)
  })

  it('cannot reconcile a document with no period total', () => {
    const withoutTotal = monoStatement().replace('Сума зарахувань за період: 1 470.00 UAH', '')

    expect(parseStatement(withoutTotal, BankProvider.MONO)?.creditsReconciled).toBeNull()
  })
})

describe('what is not a statement at all', () => {
  /**
   * `null` means "this is not one of this bank's statements" — a receipt, the
   * other bank's document, a file that merely opened. It is never "no
   * movements found", which is a parsed statement with none.
   */
  it.each([
    ['empty', ''],
    ['a receipt', 'Квитанція № 6K4A-0000-0000-0000 Сума (грн) 1 470.00 Одержувач'],
    ['the other bank’s statement', privatStatement()]
  ])('refuses %s', (_, text) => {
    expect(parseStatement(text, BankProvider.MONO)).toBeNull()
  })

  it.each([
    ['no owner', monoStatement().replace(`Клієнт: ${NAME}`, '')],
    ['no card', monoStatement().replace(`Інформація по картці: ${MONO_MASK}`, '')],
    ['no period', monoStatement().replace('Період: 13.09.2026 - 17.09.2026', '')]
  ])('refuses a document with %s, rather than half-reading it', (_, text) => {
    expect(parseStatement(text, BankProvider.MONO)).toBeNull()
  })

  it('refuses a bank it has no dialect for', () => {
    expect(parseStatement(monoStatement(), BankProvider.PUMB)).toBeNull()
  })
})

describe('readStatementNumber', () => {
  const NUMBER = PRIVAT_NUMBER

  /**
   * The name first, because a document the bank served is named after its own
   * number — exact, and no parsing. The same order the receipt facade uses.
   */
  it('prefers the file name the bank gave it', () => {
    expect(
      readStatementNumber(BankProvider.PRIVAT, `statement-${NUMBER}.pdf`, 'no number here')
    ).toBe(NUMBER)
  })

  it('falls back to the page footer for a file somebody renamed', () => {
    expect(
      readStatementNumber(BankProvider.PRIVAT, 'downloaded.pdf', privatPageFooter(1))
    ).toBe(NUMBER)
  })

  /**
   * **There is no fixed prefix, and believing there was one refused every
   * statement this product was ever sent.**
   *
   * The pattern demanded `QB`, read off the single sample the reader was built
   * against. Two numbers captured 2026-09-21 began `IR` and `Q2`; PrivatBank
   * confirmed both through `find-document` and served its own copy of each,
   * while this build could not so much as read them off the file name. The
   * length and the alphabet are all the samples agree on.
   */
  it.each(['IR0ABCDEFGH00000', 'Q20ABCDEFGH00000', '0000000000000000'])(
    'reads %p, which carries no particular prefix',
    (number) => {
      expect(readStatementNumber(BankProvider.PRIVAT, `statement-${number}.pdf`, '')).toBe(number)
    }
  )

  /**
   * Bounded on both sides, so it cannot take a prefix of something longer and
   * present it to the bank as a whole number.
   */
  it.each([`${NUMBER}0`, `0${NUMBER}`, 'QB00ABCDEFGH000', 'QB00-ABCDEFGH0000'])(
    'refuses %p',
    (candidate) => {
      expect(readStatementNumber(BankProvider.PRIVAT, candidate, candidate)).toBeNull()
    }
  )

  /**
   * **In the text the `№` and the page count are both required**, and the
   * document is why. A row's own details carry `Угода № SAMD…` and `документ №`
   * followed by sixteen digits — a transaction narrative is somebody else's
   * text and entitled to contain anything. The footer is asserted in full, so
   * the only thing that can be read as this document's number is the line that
   * numbers its pages.
   */
  it('reads the number off the page footer and not out of a row’s details', () => {
    const statement = privatStatement()

    expect(statement).toContain('документ № 0000000000000000')
    expect(readStatementNumber(BankProvider.PRIVAT, 'renamed.pdf', statement)).toBe(NUMBER)
  })

  it('reads nothing from a bare number standing in the text with no footer', () => {
    expect(readStatementNumber(BankProvider.PRIVAT, 'renamed.pdf', `Угода № ${NUMBER} від`)).toBeNull()
  })

  /**
   * The footer pattern is global and shared with the page-footer count, so
   * `exec` on it would carry `lastIndex` between the two callers and read from
   * the middle of the document — or, on the second call, not at all.
   */
  it('reads the same number however many times it is asked', () => {
    const statement = privatStatement({ pages: 11 })
    const read = () => readStatementNumber(BankProvider.PRIVAT, 'renamed.pdf', statement)

    expect([read(), read(), read()]).toEqual([NUMBER, NUMBER, NUMBER])
  })

  /**
   * Monobank numbers nothing: its statements are proven by the signature on the
   * bytes, not by asking the bank about a code. `null` is that asymmetry, not a
   * gap.
   */
  it('has nothing to read for monobank', () => {
    expect(readStatementNumber(BankProvider.MONO, `statement-${NUMBER}.pdf`, NUMBER)).toBeNull()
  })
})
