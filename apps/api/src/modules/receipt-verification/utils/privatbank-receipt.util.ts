import { cardDigits, CARD_NUMBER_LENGTH } from '@transacto/contracts'
import {
  PrivatbankRecipientKind,
  type PrivatbankReceiptFields,
  type PrivatbankRecipient
} from 'src/shared/interfaces'

/**
 * Reading a PrivatBank receipt.
 *
 * **This parses a rendered document, and that is the whole risk.** Monobank's
 * receipt is verified by asking the state service, which answers with the
 * payment as JSON; PrivatBank's own service answers only "this code exists" and
 * puts the sum, the account and the date inside a PDF. So the facts a payout is
 * matched against come from a layout, and a layout changes without telling
 * anybody — the same failure mode as the Transacto panel's tables.
 *
 * Everything here is therefore **label-anchored and refuses rather than
 * guesses**. A field this cannot find with certainty is `null`, which upstream
 * is a refusal; nothing falls back to a position, a first-number-on-the-line, or
 * a default. Refusing a genuine receipt costs a user one appeal to an operator.
 * Accepting the wrong number would settle somebody else's payout.
 *
 * Captured 2026-09-07 from a real receipt, with text coordinates.
 */

/**
 * The amounts row, and the reason it is matched as a pair.
 *
 * The receipt renders a two-column table whose header is one text run,
 * `'Комісія Сума'` at x=403, and whose values are one run below it,
 * `'15,00 500,00'` at x=404. Flattened into a line the two runs sit next to
 * each other, so the **second** number is the payment and the first is the fee.
 *
 * Matched as a pair, header included, so that the mapping is asserted rather
 * than assumed: if their columns are ever reordered or the header is renamed,
 * this stops matching and the receipt is refused, instead of quietly settling a
 * payout against a fifteen-hryvnia fee.
 */
const FEE_AND_AMOUNT = /Комісія\s+Сума(?!\s+словами)\s+([\d\s]+,\d{2})\s+([\d\s]+,\d{2})/

/**
 * The same row when no fee column is rendered.
 *
 * Deliberately guarded against `Комісія`: without the guard this pattern would
 * match the two-column layout too and take the *fee* as the amount, which is
 * the one misreading that could matter. Tried only after {@link FEE_AND_AMOUNT}
 * has failed, and refuses if anything follows the number that looks like a
 * second column.
 */
const AMOUNT_ONLY = /(?<!Комісія\s)Сума(?!\s+словами)\s+([\d\s]+,\d{2})(?!\s*[\d\s]+,\d{2})/

/**
 * When the money actually moved.
 *
 * `Дата виконання`, not `Дата складання` beside it and not `Дата валютування`
 * below it: a receipt carries all three, they are equal on an ordinary transfer,
 * and only this one states execution.
 */
const EXECUTED_AT = /Дата\s+виконання\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/

/**
 * The recipient's account, in full.
 *
 * Label-anchored because the document names two accounts — the payer's IBAN is
 * on the same line — and the labels are the only thing that tells them apart.
 */
const RECIPIENT_ACCOUNT = /Рахунок\s+отримувача\s+(UA[0-9]{27}|[\d\s]{16,32})/i

/** Their decimal separator, and the grouping spaces inside a large sum. */
const DECIMAL_COMMA = ','
const SPACES = /\s+/g

/** Kyiv, which is what the receipt's clock is. Never assume a fixed offset. */
const RECEIPT_TIME_ZONE = 'Europe/Kyiv'

/**
 * The three facts a payout is matched against, or `null` if any is uncertain.
 *
 * All or nothing on purpose. A partial answer would have to be completed by
 * something, and everything available to complete it — a default, a zero, the
 * expectation itself — turns a check into a formality.
 */
export const parsePrivatbankReceipt = (text: string): PrivatbankReceiptFields | null => {
  const amountUah = readAmountKopecks(text)
  const paidAt = readExecutedAt(text)
  const recipient = readRecipient(text)

  if (amountUah === null || paidAt === null || recipient === null) return null

  return { amountUah, paidAt, recipient }
}

/** The payment, in kopecks — never the fee beside it. */
const readAmountKopecks = (text: string): number | null => {
  const paired = FEE_AND_AMOUNT.exec(text)
  if (paired !== null) return toKopecks(paired[2])

  const alone = AMOUNT_ONLY.exec(text)

  return alone === null ? null : toKopecks(alone[1])
}

/**
 * `'1 234,56'` → `123456`.
 *
 * Their thousands separator is a space, so it is stripped before the comma is
 * read; a sum of ₴1 234,56 parsed without that step is ₴1.
 */
const toKopecks = (rendered: string): number | null => {
  const [whole, fraction] = rendered.replace(SPACES, '').split(DECIMAL_COMMA)
  const kopecks = Number(`${whole}${fraction}`)

  return Number.isSafeInteger(kopecks) && kopecks > 0 ? kopecks : null
}

/**
 * The execution moment, as an instant.
 *
 * The receipt states Kyiv local time with no offset on it, and everything this
 * is compared against is UTC — the reservation and the pay deadline. Converting
 * with a fixed `+03:00` would be right for eight months of the year and an hour
 * out for the other four, which on a fifteen-minute window is the difference
 * between a receipt inside it and one refused as too early. So the offset is
 * resolved for that date, in that zone, by the runtime.
 */
const readExecutedAt = (text: string): Date | null => {
  const found = EXECUTED_AT.exec(text)
  if (found === null) return null

  const [, day, month, year, hour, minute] = found
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  )

  if (Number.isNaN(asUtc)) return null

  return new Date(asUtc - kyivOffsetMs(asUtc))
}

/**
 * How far ahead of UTC Kyiv was at that instant, in milliseconds.
 *
 * Asked of the runtime rather than hard-coded, so summer and winter time are
 * whatever the tz database says they were. The instant passed in is the wall
 * clock read as if it were UTC, which is within an hour of the real one — near
 * enough that it lands on the correct side of every changeover except within an
 * hour of it, and a receipt written in that hour is an hour out at worst.
 */
const kyivOffsetMs = (instant: number): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RECEIPT_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instant))

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value)
  // `formatToParts` renders midnight as hour 24 under `hour12: false`.
  const hour = read('hour') % 24

  const asKyiv = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'))

  return asKyiv - Math.floor(instant / 1000) * 1000
}

/**
 * What the receipt names as the recipient's account — a card or an IBAN.
 *
 * **An IBAN is a successful read, not a failure**, and the distinction matters
 * more than it looks. PrivatBank prints one on every transfer that stays inside
 * PrivatBank, which is an ordinary thing for a user to do; treating it as
 * unparseable would log "their layout has changed" on a routine receipt and cry
 * wolf until nobody read the line. Whether an IBAN can settle a payout is the
 * matching rules' question, and they answer it with a refusal of its own.
 *
 * `null` is reserved for what it should be: a receipt whose recipient this
 * build genuinely could not find.
 */
const readRecipient = (text: string): PrivatbankRecipient | null => {
  const found = RECIPIENT_ACCOUNT.exec(text)
  if (found === null) return null

  const value = found[1].trim()

  if (IBAN.test(value)) return { kind: PrivatbankRecipientKind.IBAN, iban: value.toUpperCase() }

  const digits = cardDigits(value)

  return digits.length === CARD_NUMBER_LENGTH
    ? { kind: PrivatbankRecipientKind.CARD, card: digits }
    : null
}

/** A Ukrainian IBAN: `UA` and twenty-seven digits. */
const IBAN = /^UA[0-9]{27}$/i
