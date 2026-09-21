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
   * PrivatBank prints one in every page footer and names the file after it, and
   * it is the key to the far stronger check: ask the bank whether that number
   * exists and read **their** copy rather than the upload. Monobank has no
   * equivalent — its statements are proven by the signature on the bytes — so
   * this is `null` there, and that asymmetry is the whole difference between
   * how the two are verified.
   *
   * **Two patterns, because the two sources state it differently.** In the
   * document it sits behind a `№` on a line of its own shape, and that anchor
   * is what makes reading it safe; a file name carries the bare string with no
   * anchor at all. One pattern would therefore have to be the unanchored one,
   * applied to a whole statement — and a statement is full of sixteen-character
   * runs.
   */
  readonly documentNumber: {
    /** Bare, as the bank names the file: `statement-<number>.pdf`. */
    readonly inName: RegExp
    /** Anchored on the label the document prints it behind. */
    readonly inText: RegExp
  } | null
  /** `.` for monobank, `,` for PrivatBank. */
  readonly decimal: '.' | ','
  /** One row, anchored on its date and time and closed by a fixed tail. */
  readonly row: RegExp
  /**
   * How to read a bank that issues the same statement with and without a
   * running balance, and how to tell which one arrived.
   *
   * **Chosen by the header, never by trying both.** The no-balance row pattern
   * is a *prefix* of the ordinary one, so reading a document that has the
   * column with the pattern that does not would match every row short — and
   * report a misread row as a clean one, which is the single failure this
   * reader exists to make impossible. The other way round is safe: rows simply
   * do not match, and `unreadableRows` refuses the statement.
   *
   * So the presence of the column is asserted from the table heading and the
   * pattern follows from it. `null` for a bank observed issuing one shape.
   */
  readonly withoutRunningBalance: {
    /** The column heading whose **presence** means the balance is there. */
    readonly declaredBy: string
    /** The row as it reads when it is not. */
    readonly row: RegExp
  } | null
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
  // One shape observed, and a monobank statement always prints the balance
  // after each operation.
  withoutRunningBalance: null,
  falseAnchor: null
}

/**
 * A PrivatBank document's own number: sixteen uppercase letters and digits.
 *
 * **There is no fixed prefix, and believing there was one refused every
 * statement this product was ever sent.** The pattern here demanded `QB` — read
 * off the single sample the reader was built against — and the numbers users
 * actually arrive with look nothing like it. Two, captured 2026-09-21, began
 * `IR` and `Q2`; both were confirmed by `find-document`, and PrivatBank served
 * its own copy of each. What the samples agree on is the length and the
 * alphabet, so that is all this says.
 *
 * No example is written out, deliberately. A real number resolves at
 * `pb.ua/check` to a real person's statement, which makes it a live identifier
 * rather than a format note — the kind of value the root `CLAUDE.md` keeps out
 * of this repository for good. The specs invent their own.
 */
const PRIVATBANK_DOCUMENT_NUMBER = '[0-9A-Z]{16}'

/**
 * The line PrivatBank repeats at the foot of every page.
 *
 * It does two jobs, and having one pattern do both is the point rather than a
 * convenience. It begins with a date and a time, so it looks exactly like the
 * start of a row and has to be excluded before unreadable rows are counted —
 * and it is **also the one place in the document that states its own number**,
 * which is the key to asking the bank for its own copy. Two patterns over one
 * line is two chances to disagree about what that line is.
 *
 * `\s+з\s+\d+` closes it, so a footer is asserted in full rather than found by
 * its `№`: a statement's transaction details are somebody's payment narrative
 * and entitled to contain anything, `№` included.
 */
const PRIVATBANK_PAGE_FOOTER = new RegExp(
  `\\d{2}\\.\\d{2}\\.\\d{4}\\s+\\d{2}:\\d{2}\\s+№\\s+(?<number>${PRIVATBANK_DOCUMENT_NUMBER})` +
    `(?![0-9A-Z])\\s+Сторінка\\s+\\d+\\s+з\\s+\\d+`,
  'g'
)

/**
 * One PrivatBank row, with or without the running balance that closes it.
 *
 * `… operation CUR card fee discount [balance]` — the currency sits between the
 * two amounts here, and the card-currency one comes *after* it, the opposite way
 * round from monobank.
 *
 * Built by one function so the two shapes cannot drift into disagreeing about
 * the columns they share, which is the whole of what a second copy would buy.
 * Which one a document is read with is decided in one place — see
 * {@link StatementDialect.withoutRunningBalance}.
 */
const privatbankRow = (closedBy: string): RegExp =>
  new RegExp(
    `(?<date>\\d{2}\\.\\d{2}\\.\\d{4})\\s+(?<time>\\d{2}:\\d{2})\\s+` +
      `.*?\\s*${amountPattern(',')}\\s+(?<currency>[A-Z]{3})\\s+` +
      `(?<card>${amountPattern(',')})\\s+${amountPattern(',')}\\s+` +
      `${amountPattern(',')}${closedBy}`,
    'g'
  )

/** The balance after the operation, which the shorter statement omits. */
const PRIVATBANK_RUNNING_BALANCE = `\\s+${amountPattern(',')}`

const PRIVATBANK: StatementDialect = {
  bank: BankProvider.PRIVAT,
  labels: PRIVATBANK_STATEMENT_LABELS,
  decimal: ',',
  ownerEndsAt: 'Дата народження:',
  documentNumber: {
    // Bounded on both sides so it cannot take a prefix of something longer and
    // present it to the bank as a whole number. The bank's own name for the
    // file is `statement-<number>.pdf`, so the boundary on the left is a dash.
    inName: new RegExp(`(?<![0-9A-Z])(${PRIVATBANK_DOCUMENT_NUMBER})(?![0-9A-Z])`),
    inText: PRIVATBANK_PAGE_FOOTER
  },
  row: privatbankRow(PRIVATBANK_RUNNING_BALANCE),
  /**
   * «Довідка містить тільки інформацію про рух коштів без відображення залишків
   * по картці/рахунку» — Privat24 offers the statement both ways, and the
   * shorter one drops the last column of every row.
   *
   * Captured 2026-09-21, from two statements of the same day and account pulled
   * minutes apart: one carried the balance, one did not, and the reader could
   * only read the first. The heading is what tells them apart.
   */
  withoutRunningBalance: {
    declaredBy: 'Залишок після операції',
    row: privatbankRow('')
  },
  falseAnchor: PRIVATBANK_PAGE_FOOTER
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

/** The dash any of these documents may separate two dates with. */
const DATE_RANGE_DASH = '\\s*[-—–]\\s*'

/**
 * `20.09.2026` on its own — a statement covering one day.
 *
 * **Anchored at the start of the label's window, and not merely "a date near
 * `Період:`".** The window runs 160 characters past the label and a statement's
 * header is full of dates: `Коли видано документ`, `Угода № … від`, a credit
 * limit stated as of a day. Any of them would do as "the period" to a pattern
 * that searched.
 *
 * The lookahead is what keeps a range from being read as its first day. A range
 * is tried first, so this is reachable only when that failed — but a range that
 * failed for a reason nobody predicted must refuse, not quietly narrow to a
 * single day: a period shorter than the document's own is a period that can
 * still satisfy `PERIOD_TOO_SHORT` while covering less than it claims.
 */
const PERIOD_DAY = new RegExp(
  `^\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})(?!${DATE_RANGE_DASH}\\d{2}\\.)`
)

/**
 * The days a statement covers, as an inclusive range of whole days.
 *
 * `to` runs to the **end** of its day, not to midnight at its start. Neither
 * bank prints a time here, so a reader that took the later date literally would
 * declare every statement short of its own final day — and refuse every dispute
 * raised on the day it was pulled, which is all of them.
 *
 * **Two dates or one.** A range is what both banks print for a period spanning
 * days; PrivatBank prints a bare date for a statement covering a single one,
 * and reading only ranges refused those outright — which is the commonest
 * statement there is, because a seller answering a dispute pulls today's.
 */
const readPeriod = (
  text: string,
  dialect: StatementDialect
): { from: Date; to: Date } | null => {
  const window = after(text, dialect.labels.PERIOD)
  if (window === null) return null

  const edges = readPeriodEdges(window)
  if (edges === null) return null

  const from = startOfKyivDay(edges.first)
  const lastMinute = lastMinuteOfKyivDay(edges.last)

  if (from === null || lastMinute === null) return null

  // To the end of that minute, so the final day is covered whole.
  const to = new Date(lastMinute.getTime() + LAST_MINUTE_MS)

  return to < from ? null : { from, to }
}

/** A day as the documents print it: `[day, month, year]`. */
type PrintedDay = readonly [string, string, string]

/**
 * The first and last day a period names, from either form it is printed in.
 *
 * The range is tried first and the bare date only if it did not match, so the
 * two cannot both claim the same text — see {@link PERIOD_DAY} for why that
 * order is load-bearing rather than incidental.
 */
const readPeriodEdges = (
  window: string
): { first: PrintedDay; last: PrintedDay } | null => {
  const range = PERIOD.exec(window)

  if (range !== null)
    return {
      first: [range[1], range[2], range[3]],
      last: [range[4], range[5], range[6]]
    }

  const day = PERIOD_DAY.exec(window)
  if (day === null) return null

  const only: PrintedDay = [day[1], day[2], day[3]]

  return { first: only, last: only }
}

const startOfKyivDay = ([day, month, year]: PrintedDay): Date | null =>
  fromKyivWallClock(Number(year), Number(month), Number(day), 0, 0)

const lastMinuteOfKyivDay = ([day, month, year]: PrintedDay): Date | null =>
  fromKyivWallClock(Number(year), Number(month), Number(day), 23, 59)

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
 * Which of a bank's row shapes this particular document is written in.
 *
 * **The heading decides, and it decides before a row is read.** The alternative
 * — try the full pattern, fall back to the short one — reads a truncated table
 * with the short pattern and calls it clean, because the short pattern is a
 * prefix of the full one. That is the one outcome this reader may never
 * produce, so the column's presence is asserted from the table's own heading
 * and the pattern follows.
 */
const rowPatternFor = (text: string, dialect: StatementDialect): RegExp => {
  const shorter = dialect.withoutRunningBalance

  if (shorter === null || text.includes(shorter.declaredBy)) return dialect.row

  return shorter.row
}

/**
 * Every movement, and a count of the rows that would not read.
 *
 * The reconciliation is the point. Anchors are what *looks* like a row; matches
 * are what was read; page footers are what only looks like one. The difference
 * is rows this reader failed on, and a caller refuses the statement on any.
 */
const readRows = (
  text: string,
  dialect: StatementDialect
): { movements: readonly StatementMovement[]; unreadableRows: number } => {
  const anchors = (text.match(ANCHOR) ?? []).length
  const falseAnchors =
    dialect.falseAnchor === null ? 0 : (text.match(dialect.falseAnchor) ?? []).length

  const movements = [...text.matchAll(rowPatternFor(text, dialect))].flatMap((row) => {
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
 * costs no parsing. The text is the fallback, and a real one — the number is
 * printed in every page footer — so a file somebody renamed on the way still
 * reaches the bank's own copy.
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
  const patterns = DIALECTS[bank]?.documentNumber
  if (!patterns) return null

  const named = patterns.inName.exec(fileName)?.[1]
  if (named !== undefined) return named

  // `matchAll` rather than `exec`, because the footer pattern is global and
  // shared with the anchor count — `exec` on a global regex carries
  // `lastIndex` from wherever it was used last, so the second caller reads
  // from the middle of the document or not at all.
  const [printed] = [...text.matchAll(patterns.inText)]

  return printed?.groups?.number ?? null
}
