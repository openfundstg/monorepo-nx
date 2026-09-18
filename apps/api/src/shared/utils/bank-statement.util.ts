import { BankProvider, cardTail } from '@transacto/contracts'
import { fromKyivWallClock } from 'src/shared/utils/kyiv-time.util'
import {
  MONOBANK_STATEMENT_LABELS,
  PRIVATBANK_STATEMENT_LABELS,
  type ParsedStatement,
  type StatementMovement
} from 'src/shared/interfaces/bank-statement.interface'

/**
 * Reading a bank statement, for the one question it is asked.
 *
 * **The question is always negative** — "no credit of ₴X reached this card in
 * this window" — so the failure that matters is not a wrong figure but a
 * silently missing row. Everything below is arranged around that: rows are
 * counted before they are read, the count is reconciled against what parsed,
 * and a mismatch of one is a refusal.
 *
 * Contract and shapes: `shared/interfaces/bank-statement.interface.ts`.
 * The two banks differ only in separators, labels and the order of two columns,
 * so they are one reader and two dialects rather than two readers that start
 * out identical and learn to disagree.
 */

/** Everything a statement's own labels and layout differ by, per bank. */
interface StatementDialect {
  readonly bank: BankProvider
  readonly labels: {
    readonly OWNER: string
    readonly CARD: string
    readonly ACCOUNT: string
    readonly PERIOD: string
    readonly TOTAL_CREDITED: string
  }
  /**
   * The label that follows the account holder's name.
   *
   * Captured, not inferred, and it has to be: after `receipt-checker` collapses
   * the document there are no lines left, so "the rest of the line" is the rest
   * of the document — and a name and a label are both capitalised words with
   * spaces in them, which no amount of lexing tells apart. Both banks print
   * `Дата народження:` next.
   *
   * If a bank reorders its header this stops matching and the statement is
   * refused, which is the direction to fail in.
   */
  readonly ownerEndsAt: string
  /**
   * The bank's own number for this document, if it has one.
   *
   * PrivatBank prints one in every page header and names the file after it, and
   * it is the key to the far stronger check: ask the bank whether that number
   * exists and read **their** copy rather than the upload. Monobank has no
   * equivalent — its statements are proven by the signature on the bytes — so
   * this is `null` there, and that asymmetry is the whole difference between
   * how the two are verified.
   */
  readonly documentNumber: RegExp | null
  /** `.` for monobank, `,` for PrivatBank. */
  readonly decimal: '.' | ','
  /** One row, anchored on its date and time and closed by a fixed tail. */
  readonly row: RegExp
  /**
   * Anything that begins with a date and a time and is **not** a row.
   *
   * PrivatBank repeats a page header on all eleven pages, and each begins
   * exactly as a row does. Counted out before rows are reconciled — without
   * this, a statement read perfectly reports ten unreadable rows and is
   * refused. `null` where a bank has no such line.
   */
  readonly falseAnchor: RegExp | null
}

/** Anything that starts like a row: a date, then a time. */
const ANCHOR = /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/g

/** A signed decimal with space-grouped thousands, in either dialect. */
const amountPattern = (decimal: '.' | ','): string =>
  `-?\\d[\\d \\u00a0]*\\${decimal}\\d{2}`

const MONOBANK: StatementDialect = {
  bank: BankProvider.MONO,
  labels: MONOBANK_STATEMENT_LABELS,
  decimal: '.',
  ownerEndsAt: 'Дата народження:',
  documentNumber: null,
  // `… MCC card operation CUR rate fee cashback balance`, and the card-currency
  // amount is the **first** of the pair — the opposite way round from Privat.
  // The whole tail is required: a row that ends short has not been read, and
  // saying so is the entire bargain that makes this acceptable.
  row: new RegExp(
    `(?<date>\\d{2}\\.\\d{2}\\.\\d{4})\\s+(?<time>\\d{2}:\\d{2}:\\d{2})\\s+` +
      `.*?\\s+\\d{4}\\s+` +
      `(?<card>${amountPattern('.')})\\s+${amountPattern('.')}\\s+` +
      `(?<currency>[A-Z]{3})\\s+(?:—|[\\d.]+)\\s+` +
      `${amountPattern('.')}\\s+${amountPattern('.')}\\s+${amountPattern('.')}`,
    'g'
  ),
  falseAnchor: null
}

const PRIVATBANK: StatementDialect = {
  bank: BankProvider.PRIVAT,
  labels: PRIVATBANK_STATEMENT_LABELS,
  decimal: ',',
  ownerEndsAt: 'Дата народження:',
  /**
   * `QB` and fourteen more characters — `QB00ABCDEFGH0000` in shape.
   *
   * **The example is invented.** A real one resolves at `pb.ua/check` to a
   * real person's statement, which makes it a live identifier rather than a
   * format note — the kind of value the root `CLAUDE.md` keeps out of this
   * repository for good.
   *
   * **One number has been seen**, so the shape is pinned no tighter than the
   * sample supports: the `QB` prefix and the length are what that sample shows,
   * and the alphabet is left as uppercase letters and digits rather than
   * narrowed to the characters that happened to appear in it. The same
   * restraint `PrivatbankReceiptStrategy` states about its own four samples.
   *
   * Bounded on both sides so it cannot take a prefix of something longer.
   */
  documentNumber: /(?<![0-9A-Z])(QB[0-9A-Z]{14})(?![0-9A-Z])/,
  // `… operation CUR card fee discount balance` — the currency sits between the
  // two amounts here, and the card-currency one comes after it.
  row: new RegExp(
    `(?<date>\\d{2}\\.\\d{2}\\.\\d{4})\\s+(?<time>\\d{2}:\\d{2})\\s+` +
      `.*?\\s*${amountPattern(',')}\\s+(?<currency>[A-Z]{3})\\s+` +
      `(?<card>${amountPattern(',')})\\s+${amountPattern(',')}\\s+` +
      `${amountPattern(',')}\\s+${amountPattern(',')}`,
    'g'
  ),
  // `17.09.2026 12:20 № QB… Сторінка 1 з 11`, once per page.
  falseAnchor: /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\s+№\s+\S+\s+Сторінка\s+\d+\s+з\s+\d+/g
}

const DIALECTS: Readonly<Record<string, StatementDialect>> = {
  [BankProvider.MONO]: MONOBANK,
  [BankProvider.PRIVAT]: PRIVATBANK
}

/** Whether this product can read a statement from this bank at all. */
export const canReadStatement = (bank: BankProvider): boolean => bank in DIALECTS

/**
 * A statement's figures, or `null` when it is not one of this bank's statements.
 *
 * `null` means the document did not carry the header a statement carries — a
 * receipt, another bank's statement, or a file that merely opened. It is not
 * "no movements found", which is a `ParsedStatement` with none.
 */
export const parseStatement = (text: string, bank: BankProvider): ParsedStatement | null => {
  const dialect = DIALECTS[bank]
  if (!dialect) return null

  const normalised = text.replace(/\s+/g, ' ')

  const ownerName = readOwner(normalised, dialect)
  // `5375 **** **** 4321` on monobank, `537541******4321` on PrivatBank — one
  // pattern over both, because only the trailing four digits are kept either way.
  const cardMask = field(normalised, dialect.labels.CARD, /\d[\d *]*\*[\d *]*\d{4}/)
  const period = readPeriod(normalised, dialect)

  // All three or nothing. A document missing any of them cannot say whose
  // account it is or what it covers, which is the whole of what makes it
  // evidence — and half of one is worse than none, because it looks readable.
  if (ownerName === null || cardMask === null || period === null) return null

  const tail = cardTail(cardMask)
  if (tail === '') return null

  const { movements, unreadableRows } = readRows(normalised, dialect)

  const totalCreditedKopecks = readAmount(
    field(normalised, dialect.labels.TOTAL_CREDITED, new RegExp(amountPattern(dialect.decimal))),
    dialect.decimal
  )

  const creditsFound = movements
    .filter((movement) => movement.amountKopecks > 0)
    .reduce((sum, movement) => sum + movement.amountKopecks, 0)

  return {
    bank: dialect.bank,
    ownerName,
    cardTail: tail,
    // Kept only to tell two accounts apart; never compared against anything a
    // user typed, and never logged.
    iban: field(normalised, dialect.labels.ACCOUNT, /UA[0-9A-Z]{27}/),
    periodFrom: period.from,
    periodTo: period.to,
    totalCreditedKopecks,
    movements,
    unreadableRows,
    creditsReconciled:
      totalCreditedKopecks === null ? null : creditsFound === totalCreditedKopecks
  }
}

/**
 * How far past a label a field's value may be looked for.
 *
 * Bounded so a pattern cannot wander off and match something belonging to
 * another field — an IBAN further down the document, a date inside a
 * transaction. Generous against the longest value on either statement and far
 * short of the next section.
 */
const FIELD_WINDOW = 160

/** The text just after a label, or `null` when the label is absent. */
const after = (text: string, label: string): string | null => {
  const at = text.indexOf(label)

  return at === -1 ? null : text.slice(at + label.length, at + label.length + FIELD_WINDOW)
}

/**
 * The first thing matching `pattern` just after a label.
 *
 * **A pattern, never "everything up to the next label".** The values on these
 * documents are separated from the labels that follow them by nothing but a
 * space, and a name and a label are both capitalised words — so a reader that
 * cut at the next colon either swallowed the following label or, greedily,
 * swallowed the value itself. Matching the shape of the value is the only thing
 * that is decidable here, and it refuses rather than guesses.
 */
const field = (text: string, label: string, pattern: RegExp): string | null => {
  const window = after(text, label)
  if (window === null) return null

  return pattern.exec(window)?.[0]?.trim() ?? null
}

/**
 * The account holder, read as everything between their label and the next one.
 *
 * The one field with no shape of its own: a name is words, and so is a label.
 * See {@link StatementDialect.ownerEndsAt} for why the terminator is captured
 * rather than inferred.
 */
const readOwner = (text: string, dialect: StatementDialect): string | null => {
  const window = after(text, dialect.labels.OWNER)
  if (window === null) return null

  const stop = window.indexOf(dialect.ownerEndsAt)
  const value = (stop === -1 ? window : window.slice(0, stop)).trim()

  // Two words at minimum — a surname and a given name. One word is the label
  // having moved, not somebody with a single name.
  return value.split(' ').filter(Boolean).length >= 2 ? value : null
}

/** `01.09.2026 - 17.09.2026` or `01.09.2026 — 17.09.2026`. */
const PERIOD = /(\d{2})\.(\d{2})\.(\d{4})\s*[-—–]\s*(\d{2})\.(\d{2})\.(\d{4})/

/**
 * The days a statement covers, as an inclusive range of whole days.
 *
 * `to` runs to the **end** of its day, not to midnight at its start. Both banks
 * print a period as two dates with no times, so a reader that took the later
 * one literally would declare every statement short of its own final day — and
 * refuse every dispute raised on the day it was pulled, which is all of them.
 */
const readPeriod = (
  text: string,
  dialect: StatementDialect
): { from: Date; to: Date } | null => {
  const window = after(text, dialect.labels.PERIOD)
  if (window === null) return null

  const matched = PERIOD.exec(window)
  if (matched === null) return null

  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = matched

  const from = fromKyivWallClock(Number(fromYear), Number(fromMonth), Number(fromDay), 0, 0)
  const lastMinute = fromKyivWallClock(Number(toYear), Number(toMonth), Number(toDay), 23, 59)

  if (from === null || lastMinute === null) return null

  // To the end of that minute, so the final day is covered whole.
  const to = new Date(lastMinute.getTime() + LAST_MINUTE_MS)

  return to < from ? null : { from, to }
}

/**
 * Kopecks from a printed amount, by integer arithmetic.
 *
 * Never `Number(x) * 100`, which is inexact for some two-decimal values and
 * lands the error in somebody's transfer — the same reason
 * `panelAmountToKopecks` counts digit groups rather than multiplying.
 *
 * Thousands are grouped with a space, which may arrive as a non-breaking one;
 * both are stripped. The sign is kept: it is what tells a credit from a debit,
 * and it is the only thing that does.
 */
export const readAmount = (raw: string | null, decimal: '.' | ','): number | null => {
  if (raw === null) return null

  // `\s` already covers the non-breaking space these documents group
  // thousands with, so the class is one character rather than two — and a
  // literal one in the source is invisible to whoever reads it next.
  const cleaned = raw.replace(/\s/g, '')
  const matched = new RegExp(`^(-?)(\\d+)\\${decimal}(\\d{2})$`).exec(cleaned)
  if (matched === null) return null

  const [, sign, whole, fraction] = matched
  const kopecks = Number(whole) * 100 + Number(fraction)

  return sign === '-' ? -kopecks : kopecks
}

/**
 * Every movement, and a count of the rows that would not read.
 *
 * The reconciliation is the point. Anchors are what *looks* like a row; matches
 * are what was read; page headers are what only looks like one. The difference
 * is rows this reader failed on, and a caller refuses the statement on any.
 */
const readRows = (
  text: string,
  dialect: StatementDialect
): { movements: readonly StatementMovement[]; unreadableRows: number } => {
  const anchors = (text.match(ANCHOR) ?? []).length
  const falseAnchors =
    dialect.falseAnchor === null ? 0 : (text.match(dialect.falseAnchor) ?? []).length

  const movements = [...text.matchAll(dialect.row)].flatMap((row) => {
    const at = readMoment(row.groups?.date, row.groups?.time)
    const amountKopecks = readAmount(row.groups?.card ?? null, dialect.decimal)
    const currencyCode = row.groups?.currency

    if (at === null || amountKopecks === null || currencyCode === undefined) return []

    return [{ at, amountKopecks, currencyCode }]
  })

  return {
    movements,
    // Never negative: more matches than anchors would mean the row pattern
    // found something the anchor pattern did not, which cannot happen while the
    // row begins with the anchor — but a floor costs nothing and a negative
    // count of unread rows would read as "all good".
    unreadableRows: Math.max(0, anchors - falseAnchors - movements.length)
  }
}

const MOMENT = /^(\d{2})\.(\d{2})\.(\d{4})$/
const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Everything but the last millisecond of a minute. */
const LAST_MINUTE_MS = 59_999

/**
 * One row's moment, read as a Kyiv wall clock.
 *
 * `fromKyivWallClock` asks the tz database rather than assuming an offset, for
 * the reason it was written for the receipt parsers: a fixed `+03:00` is right
 * for eight months of the year and an hour out for the other four, and an hour
 * is the difference between a credit inside an order's window and one outside
 * it.
 *
 * PrivatBank prints `HH:MM` and monobank `HH:MM:SS`, and **the seconds are
 * kept**. They were discarded, on the reasoning that a minute is finer than
 * anything this is compared against — which was simply untrue. The window a
 * credit is matched into is bounded by timestamps this process wrote itself,
 * and those have seconds: a ₴300 credit printed at 18:14:20 was read as
 * 18:14:00, the order it belonged to had been recorded at 18:14:04, and a
 * statement that plainly showed the money reported as showing none.
 *
 * Absent seconds are zero, which is what PrivatBank's `HH:MM` means.
 */
const readMoment = (date: string | undefined, time: string | undefined): Date | null => {
  if (date === undefined || time === undefined) return null

  const day = MOMENT.exec(date)
  const clock = CLOCK.exec(time)
  if (day === null || clock === null) return null

  return fromKyivWallClock(
    Number(day[3]),
    Number(day[2]),
    Number(day[1]),
    Number(clock[1]),
    Number(clock[2]),
    clock[3] === undefined ? 0 : Number(clock[3])
  )
}

/**
 * The bank's own number for a statement, from its name or its text.
 *
 * **The file name is tried first**, exactly as the receipt facade does: a
 * document the bank served is named after its own number, which is exact and
 * costs no parsing. The text is the fallback, for a file a user renamed.
 *
 * `null` for a bank that numbers nothing — monobank — and for a document where
 * no number of the right shape appears. A caller reads that as "this cannot be
 * checked against the bank", never as "the bank said no".
 */
export const readStatementNumber = (
  bank: BankProvider,
  fileName: string,
  text: string
): string | null => {
  const pattern = DIALECTS[bank]?.documentNumber
  if (!pattern) return null

  return pattern.exec(fileName)?.[1] ?? pattern.exec(text)?.[1] ?? null
}
