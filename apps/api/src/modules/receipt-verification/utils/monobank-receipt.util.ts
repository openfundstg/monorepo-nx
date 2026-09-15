import type { MonobankReceiptFields } from 'src/modules/receipt-verification/interfaces'
import { fromKyivWallClock, readRecipientCard } from 'src/shared/utils'

/**
 * Reading a monobank receipt.
 *
 * **The signature proves the document; this reads it.** `ca.monobank.ua` says
 * the bytes are the bank's and unaltered, and says nothing whatever about the
 * payment — so the sum, the recipient and the moment come from the rendered
 * page, exactly as they do for PrivatBank.
 *
 * That the document is *proven* changes what can go wrong here, and it is worth
 * being precise about it. Nobody can have edited the text: a single altered bit
 * fails verification before this is ever called. What remains is that monobank
 * may one day render the same facts differently, and this would read the new
 * layout with the old rules.
 *
 * So the same discipline as the PrivatBank parser: **label-anchored, and it
 * refuses rather than guesses.** A field this cannot find with certainty is
 * `null`, which upstream is a refusal. Nothing falls back to a position, to the
 * first number on a line, or to a default. Refusing a genuine receipt costs a
 * user one appeal to an operator; accepting a half-read one settles a payout
 * against the wrong number.
 *
 * Captured 2026-09-08 from a real receipt's text layer.
 */

/**
 * The sum, in hryvnia.
 *
 * `(грн)` is part of the anchor and is doing real work: it separates this from
 * `Сума літерами`, which spells the same number in words two labels later, and
 * it means a receipt denominated in anything else stops matching and is refused
 * instead of being read as hryvnia. The fee is a differently labelled field —
 * `Комісія (грн)` — so unlike PrivatBank's two-column table there is no risk of
 * taking one for the other.
 *
 * The decimal separator is a **point**, and PrivatBank's is a comma. Both are
 * accepted here rather than only the observed one: a document that renders
 * `1 100,00` is unambiguous, and refusing it would be pedantry rather than
 * caution. The thousands separator is a space.
 */
const AMOUNT_UAH = /Сума\s*\(грн\)\s+([\d\s]+[.,]\d{2})/

/**
 * When the money moved.
 *
 * Kyiv local time with no offset printed, resolved by
 * {@link fromKyivWallClock}.
 */
const EXECUTED_AT = /Дата\s+і\s+час\s+операції\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/

/**
 * The recipient's card.
 *
 * **Anchored on the recipient's own block, and it has to be.** The receipt
 * carries `Платіжний інструмент` twice — once under `Відправник`, where it
 * lists the payer's IBAN *and* their own masked card, and once under
 * `Одержувач`. An unanchored pattern takes the payer's, which would compare the
 * sender's card against the payout's and refuse every genuine receipt.
 *
 * **The recipient's name is not part of the anchor, and requiring it was a
 * bug.** Monobank prints `Ім'я` only when the recipient is one of theirs; a
 * transfer out to another bank reads `Одержувач Банк одержувач ПриватБанк`
 * with no name at all. Anchoring on `Одержувач Ім'я` therefore failed every
 * outbound transfer — a genuine ₴1 000 top-up verified its signature and then
 * refused, because this pattern could not find a block that was right there.
 *
 * What both layouts do carry is the pair `Одержувач … Банк одержувач`, so that
 * is the anchor: structure asserted rather than distance trusted. The spans are
 * bounded so a receipt missing the field cannot reach forward into whatever
 * follows, and `Банк одержувач` is matched after `Одержувач` rather than
 * instead of it — the heading comes first in the document, so leftmost-first
 * starts there.
 */
const RECIPIENT_CARD =
  /Одержувач[\s\S]{0,160}?Банк\s+одержувач[\s\S]{0,160}?Платіжний\s+інструмент\s+([\d\s*]{12,32})/

/**
 * The receipt's own number.
 *
 * Anchored on the label, and read even though the caller already has a code:
 * that code may have come from the file's name, and a name is the one part of
 * an upload a user can edit without breaking a signature.
 */
const RECEIPT_NUMBER = /Квитанція\s+№\s+([0-9A-Z-]{16,19})/i

/** Sixteen alphanumerics, however the document grouped them. */
const CODE_BODY = /^[0-9A-Z]{16}$/

/** Their grouping separator inside a large sum. */
const SPACES = /\s+/g
const DECIMAL = /[.,]/

/**
 * The three facts a payout is matched against, or `null` if any is uncertain.
 *
 * All or nothing, for the reason the PrivatBank parser gives: a partial answer
 * would have to be completed by something, and everything available to complete
 * it turns a check into a formality.
 */
export const parseMonobankReceipt = (text: string): MonobankReceiptFields | null => {
  const code = readCode(text)
  const amountUah = readAmountKopecks(text)
  const paidAt = readExecutedAt(text)
  const recipientCard = readRecipient(text)

  if (code === null || amountUah === null || paidAt === null || recipientCard === null) return null

  return { code, amountUah, paidAt, recipientCard }
}

/**
 * Which of the four anchors this build could not find in a document.
 *
 * **Because "the layout could not be read" is not a diagnosis.** The first time
 * a genuine receipt failed to parse, the log said exactly that and named all
 * three fields whether or not each had been the problem — so the only way to
 * find out which label had moved was to obtain the document and read it. The
 * labels are what is named here, not the values: a label is theirs and safe to
 * print, and everything it points at is somebody's payment credential.
 */
export const monobankReceiptGaps = (text: string): readonly string[] => [
  ...(readCode(text) === null ? ['«Квитанція №»'] : []),
  ...(readAmountKopecks(text) === null ? ['«Сума (грн)»'] : []),
  ...(readExecutedAt(text) === null ? ['«Дата і час операції»'] : []),
  ...(readRecipient(text) === null ? ['«Одержувач … Банк одержувач … Платіжний інструмент»'] : [])
]

/** The number as printed, dashes kept — it is what the bank calls this receipt. */
const readCode = (text: string): string | null => {
  const found = RECEIPT_NUMBER.exec(text)
  if (found === null) return null

  const printed = found[1].toUpperCase()

  return CODE_BODY.test(printed.replace(/-/g, '')) ? printed : null
}

/** `'1 100.00'` → `110000`. */
const readAmountKopecks = (text: string): number | null => {
  const found = AMOUNT_UAH.exec(text)
  if (found === null) return null

  const [whole, fraction] = found[1].replace(SPACES, '').split(DECIMAL)
  const kopecks = Number(`${whole}${fraction}`)

  return Number.isSafeInteger(kopecks) && kopecks > 0 ? kopecks : null
}

const readExecutedAt = (text: string): Date | null => {
  const found = EXECUTED_AT.exec(text)
  if (found === null) return null

  const [, day, month, year, hour, minute] = found

  return fromKyivWallClock(Number(year), Number(month), Number(day), Number(hour), Number(minute))
}

/**
 * The recipient's card, as the receipt printed it.
 *
 * Validated by the shared {@link readRecipientCard} rather than by a rule of
 * its own, which is what this used to have — sixteen digits after stripping
 * spaces, and nothing else accepted. That is a third statement of what a card
 * looks like in a codebase that already has one, and a narrower one: the shared
 * helper takes a card **masked or whole**, which is the form `matchesMaskedCard`
 * then compares. Monobank masks the *payer's* card on the very same receipt, so
 * a day when it masks the recipient's is not a day to rediscover this.
 *
 * Whitespace comes out first because the shared pattern wants sixteen
 * contiguous characters, and a bank that ever groups the digits would otherwise
 * read as no card at all.
 */
const readRecipient = (text: string): string | null => {
  const found = RECIPIENT_CARD.exec(text)

  return found === null ? null : readRecipientCard(found[1].replace(SPACES, ''))
}
