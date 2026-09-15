import { ERROR, cardDigits, CARD_NUMBER_LENGTH } from '@transacto/contracts'
import { BadRequestException } from '@nestjs/common'
import type { NovaPayCaseData, UnifiedBankBalance } from 'src/shared/interfaces'

/** Where the page's whole state is assigned. */
const STATE_MARKER = 'window.__NOVA_DATA__'

/** `status` of a case that can still be paid into. */
export const NOVAPAY_CASE_OPEN = 'opened'

/**
 * The sentence NovaPay renders for sharing, and the digits inside it.
 *
 * Anchored on the label rather than on "sixteen digits somewhere in the text",
 * because the same sentence also carries a link whose id could contain digits
 * and, on a case named after a phone number, so could the title. The separators
 * are whatever NovaPay puts between the groups — spaces in the capture — so any
 * run of digits and spaces is taken and the digits are counted afterwards.
 */
const CARD_SENTENCE = /за номером:\s*([\d\s]+)/u

/**
 * Digs the case state out of the page.
 *
 * Brace-matched rather than regexed to the first `};`: the object contains
 * nested ones and free text, and a naive match would end at whichever brace
 * happened to be followed by a semicolon. String literals are skipped so a `}`
 * inside a case's own name cannot close the object early.
 *
 * **Every occurrence of the marker is tried, and each candidate has to look
 * like a case.** The first `{` after the first mention of the variable is not
 * necessarily the state: a bundler emitting `window.__NOVA_DATA__ || {}`, or a
 * hydration guard, puts an object there that parses perfectly and carries
 * nothing. That object used to be returned as the case — and an object with no
 * `status` reads as a case that is not `opened`, which is the verdict that
 * retires a terminal, fails its orders and releases its sale. A page
 * we cannot read must be a refusal, never a closed jar.
 *
 * `null` for a page that does not carry the state at all — a maintenance page,
 * a redirect to a login, or the day NovaPay renames the variable. The caller
 * turns that into a refusal; it must never be read as an empty case.
 */
export const parseNovaPayCase = (html: string): NovaPayCaseData | null => {
  for (
    let marker = html.indexOf(STATE_MARKER);
    marker !== -1;
    marker = html.indexOf(STATE_MARKER, marker + STATE_MARKER.length)
  ) {
    const candidate = readObjectAt(html, html.indexOf('{', marker))

    if (isCaseState(candidate)) return candidate
  }

  return null
}

/** The object literal starting at `start`, or `null` if there isn't one. */
const readObjectAt = (html: string, start: number): unknown => {
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < html.length; index++) {
    const character = html[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (character === '{') depth++
    if (character === '}') depth--
    if (depth !== 0) continue

    try {
      return JSON.parse(html.slice(start, index + 1))
    } catch {
      return null
    }
  }

  return null
}

/**
 * Whether a parsed literal is the case state rather than some other object.
 *
 * The two fields the adapter reads have to be there. `balance` is accepted as a
 * number as well as the string the capture carried: a provider switching a
 * decimal string for a number is a change we can read correctly, and refusing
 * it would stop the scrape over nothing.
 */
const isCaseState = (value: unknown): value is NovaPayCaseData => {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<NovaPayCaseData>

  return typeof candidate.status === 'string' && isFigure(candidate.balance)
}

const isFigure = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'number'

/**
 * A case's balance and target, in kopecks.
 *
 * Both arrive as decimal strings in hryvnia, like PrivatBank's, so both are
 * scaled here. The target is dropped rather than reported as zero when it is
 * missing or unparseable: `goal` is compared against the order's own total, and
 * a zero would read as a real target that nothing can ever match.
 *
 * @throws BadRequestException when the case is closed or the balance is not a number.
 */
export const adaptNovaPayBalance = (data: NovaPayCaseData): UnifiedBankBalance => {
  if (data.status !== NOVAPAY_CASE_OPEN) throw new BadRequestException(ERROR.TERMINAL.INACTIVE)

  const actualBalance = toKopecks(data.balance)
  if (actualBalance === null) throw new BadRequestException(ERROR.SCRAPER.INVALID_BALANCE_FORMAT)

  const goal = toKopecks(data.amount)

  return {
    actualBalance,
    goal: goal !== null && goal > 0 ? goal : undefined,
    // Normalised to the word every other bank's adapter reports, so nothing
    // downstream has to know that NovaPay says "opened".
    status: 'ACTIVE'
  }
}

/**
 * The card the case pays into, read out of its sharing sentence.
 *
 * `null` when the sentence is not there or does not hold a full card, which is
 * the answer a caller has to be able to act on: a NovaPay case is treated as
 * disclosing its card, so an unreadable one is refused rather than filled in
 * with a guess. Exactly sixteen digits, because a partial number is not a card
 * — the only thing worse than no card here is a plausible wrong one.
 */
export const adaptNovaPayCard = (data: NovaPayCaseData): string | null => {
  const sentence = CARD_SENTENCE.exec(data.openGraphTags?.description ?? '')
  if (sentence === null) return null

  const digits = cardDigits(sentence[1])

  return digits.length === CARD_NUMBER_LENGTH ? digits : null
}

/**
 * Grouping separators, none of which is ever a decimal point.
 *
 * `\s` in a JavaScript regex already covers every space NovaPay could group
 * with — the plain one, the non-breaking one its own `formattedAmount` uses,
 * and the thin and narrow ones — so the apostrophes are the only additions.
 */
const GROUPING = /[\s'’]/g

/** What is left has to be the whole figure, not the start of one. */
const DECIMAL = /^\d+(?:\.\d+)?$/

/**
 * Hryvnia as NovaPay writes it — `"2000.00"` — in kopecks, or `null`.
 *
 * This was `parseFloat`, and `parseFloat` is the wrong tool for money read off
 * somebody else's page: it consumes as much as it understands and returns
 * *that*. It is not a hypothetical. NovaPay groups `balance` once it passes a
 * thousand — `"1 526.00"`, verified live — while leaving the target `amount`
 * ungrouped, so `parseFloat` read a jar holding **₴1 526 as ₴1**. That is not an
 * error anywhere downstream: it is a balance below the baseline, which is how
 * this pipeline recognises a withdrawal. One scrape raised a FRAUD alert,
 * disabled the credential on Transacto, failed every pending order on the card
 * and stopped a live sale.
 *
 * The capture this contract was written from could not have caught it — it was
 * taken at a **zero** balance, where `"0.00"` is its own grouped form.
 *
 * So: grouping separators are removed, a comma is read as a decimal point only
 * where it cannot be anything else, and whatever is left must match the whole
 * string. Anything else is `null` — a refusal the scrape loop retries and logs,
 * which is the correct answer for a figure we do not understand. A plausible
 * wrong number is the one outcome that costs money.
 */
const toKopecks = (amount: string | number | undefined | null): number | null => {
  if (typeof amount === 'number') return Number.isFinite(amount) ? Math.round(amount * 100) : null
  if (typeof amount !== 'string') return null

  const normalised = normaliseComma(amount.trim().replace(GROUPING, ''))
  if (!DECIMAL.test(normalised)) return null

  return Math.round(parseFloat(normalised) * 100)
}

/**
 * A comma is a decimal point when one or two digits follow it and no dot is
 * present; otherwise it is a thousands separator and goes the way of the
 * spaces. `"1,917.00"` is one thousand nine hundred and seventeen hryvnia;
 * `"1917,00"` is the same figure written the other way; `"1,917"` is grouped,
 * because money is not written to three decimal places.
 */
const normaliseComma = (bare: string): string => {
  const lastComma = bare.lastIndexOf(',')
  if (lastComma === -1) return bare

  const decimals = bare.length - lastComma - 1
  const isDecimalPoint = decimals >= 1 && decimals <= 2 && !bare.includes('.')

  return isDecimalPoint ? bare.replace(/,/g, '.') : bare.replace(/,/g, '')
}
