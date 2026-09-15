/**
 * Reading a masked card out of a sentence somebody rendered.
 *
 * `check.gov.ua` publishes a payment's recipient as one string —
 * `'Ілля К., 444111******8671'` — an abbreviated name and a masked card joined
 * with a comma by whoever wrote their renderer. There is no structured field
 * for either half, so the card has to be recovered from the sentence, exactly
 * as NovaPay's receiving card has to be recovered from the sentence its case
 * page shares.
 *
 * Strict on purpose, and it is the strictness that carries the value: this is
 * the strongest of the three checks a receipt faces, so it must fail loudly
 * rather than quietly returning nothing the day their rendering changes. A
 * caller that gets `null` is required to treat it as a refusal, not as a
 * check it may skip.
 */

import { CARD_NUMBER_LENGTH } from '@transacto/contracts'

/**
 * A masked Ukrainian card as banks print one: some leading digits, a run of
 * asterisks, some trailing digits — sixteen characters in total.
 *
 * Anchored on the total length rather than on a fixed split, because how much
 * of a card a bank chooses to reveal is theirs to change; `matchesMaskedCard`
 * compares position by position for the same reason. The groups are bounded so
 * that a longer digit run — an IBAN, an order number — cannot be read as a card
 * that happens to start in the right place.
 */
const CARD_PATTERN = /(?<![\d*])([\d*]{16})(?![\d*])/

/**
 * The recipient's card inside a rendered recipient, or `null`.
 *
 * Accepts a card **masked or whole**, because the two verifiers state it
 * differently and both are comparable: `check.gov.ua` publishes
 * `444111******8671`, and a PrivatBank receipt names the recipient's card in
 * full when the money left PrivatBank. `matchesMaskedCard` compares position by
 * position, so a run with no asterisks in it simply compares every digit — an
 * exact match where the masked one is a probable one.
 *
 * The bounds are what keep it honest. Sixteen characters, with nothing that
 * could belong to a card on either side, so a longer digit run is never read as
 * a card that happens to start in the right place — which is precisely what an
 * IBAN is: `UA620000000000000000000000001` contains many sixteen-digit windows
 * and yields none of them.
 *
 * The result is a payment credential in every sense that matters and must never
 * reach a log line.
 */
export const readRecipientCard = (rendered: string): string | null => {
  const found = CARD_PATTERN.exec(rendered)?.[1] ?? null

  return found !== null && found.length === CARD_NUMBER_LENGTH ? found : null
}

/** A Ukrainian IBAN — an account, which is not a card and never will be. */
const IBAN = /(?<![0-9A-Z])UA[0-9]{27}(?![0-9])/i

/**
 * Whether a rendered recipient names an account rather than a card.
 *
 * Its own question, asked before {@link readRecipientCard} is allowed to fail,
 * because the two failures mean opposite things. A recipient that is an IBAN is
 * an ordinary receipt this product cannot match — PrivatBank prints one on
 * every transfer that stays inside PrivatBank. A recipient that is neither an
 * IBAN nor a card is a rendering nobody here has seen, and that one deserves
 * somebody's attention.
 */
export const isAccountNotCard = (rendered: string): boolean => IBAN.test(rendered)
