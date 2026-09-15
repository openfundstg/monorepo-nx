import { BankProvider } from '../enums/bank-provider.enum.js';

/**
 * What each bank can and may do for a Mini App sale.
 *
 * Both facts below are shared rather than restated on either side, for the same
 * reason every other rule in this package is: the create form uses them to
 * decide what to render, and the server uses them to decide what to accept. A
 * client that offered a bank the server refuses would let a user fill in a whole
 * form for nothing; one that refused a bank the server accepts would hide a
 * working product.
 */

/**
 * Banks a user may currently start a sale with.
 *
 * **Monobank is switched off**, and is the only one. It discloses nothing about
 * the card its jar pays into — see {@link BANKS_DISCLOSING_CARD} — so an order
 * on it rests entirely on the user having typed sixteen digits correctly, and a
 * wrong card is not discovered until three orders have expired against a jar
 * nobody could pay into, with the stake frozen the whole time. What every bank
 * on the list below has in common is the opposite: each says something about
 * its own card, in full or in part, before a stake is ever frozen.
 *
 * **This governs creation only.** Orders already running on those banks are
 * scraped, matched and settled exactly as before; switching a bank off must
 * never strand money that is already in flight.
 *
 * Re-enabling one is this list.
 */
export const SALE_ENABLED_BANKS: readonly BankProvider[] = [
  BankProvider.PRIVAT,
  // Back on. The reason it was off was that a wrong card could not be caught
  // until three orders had expired against it — and that reason is gone: a PUMB
  // moneybox publishes its card masked, so a card that cannot be the right one
  // is refused before the stake is ever frozen. See {@link BANKS_MASKING_CARD}.
  BankProvider.PUMB,
  // On from the day it was added: a case publishes its card in full, which is
  // the strongest form of the property this list is really about. See
  // {@link BANKS_DISCLOSING_CARD}.
  BankProvider.NOVAPAY,
];

/** Whether a sale may currently be created on this bank. */
export const isSaleBankEnabled = (bank: BankProvider): boolean =>
  SALE_ENABLED_BANKS.includes(bank);

/**
 * Banks whose drop link can be resolved to the card it pays into.
 *
 * PrivatBank's envelope record names its own card, so for a Privat link the
 * account is not something a user supplies and we hope is right — it is
 * something the bank tells us. Monobank returns an `iban` but no card number
 * (captured live, not assumed), and the form asks for a card, so the two are
 * not comparable. PUMB discloses neither.
 *
 * Three behaviours follow from this one fact, which is why it is a list rather
 * than three separate conditions:
 *
 * 1. the card field is filled in from the link and cannot be edited;
 * 2. the server takes the bank's card and ignores whatever the client sent;
 * 3. the dead-order fraud rule is skipped, because that rule exists to catch a
 *    card that does not belong to the jar — which cannot happen when the jar
 *    named the card itself.
 */
export const BANKS_DISCLOSING_CARD: readonly BankProvider[] = [
  BankProvider.PRIVAT,
  /**
   * A NovaPay case names its card in full — all sixteen digits — so the three
   * behaviours above apply to it exactly as they do to a Privat envelope.
   *
   * With one caveat worth knowing where the list is read: the number is not a
   * field of the case's JSON, which carries only an IBAN. It lives inside the
   * sentence NovaPay renders for sharing ("Закидуй гроші за номером: …"), so
   * the source is prose in one language rather than a value. It is parsed
   * strictly and a case whose sentence cannot be read is refused rather than
   * guessed at — see `adaptNovaPayCard`.
   */
  BankProvider.NOVAPAY,
];

/** Whether this bank's drop link reveals the card it pays into. */
export const disclosesCardNumber = (bank: BankProvider): boolean =>
  BANKS_DISCLOSING_CARD.includes(bank);

/**
 * Banks whose drop link reveals *part* of the card it pays into.
 *
 * PUMB's moneybox record carries `card_to_hash` — `53552800****0000`, twelve of
 * sixteen digits. Deliberately a separate list from
 * {@link BANKS_DISCLOSING_CARD} rather than a wider reading of it, because the
 * three behaviours that list governs are all wrong here:
 *
 * 1. the field stays **editable** — the user must supply the missing digits;
 * 2. the server takes the **user's** card, having checked it against the mask,
 *    because a mask is not a card and cannot be paid into;
 * 3. the dead-order fraud rule stays **on** — four unknown digits leave ten
 *    thousand candidates, and a rule that exists to catch a card belonging to
 *    somebody else must not be switched off by a partial match.
 */
export const BANKS_MASKING_CARD: readonly BankProvider[] = [BankProvider.PUMB];

/** Whether this bank's drop link reveals part of the card it pays into. */
export const masksCardNumber = (bank: BankProvider): boolean =>
  BANKS_MASKING_CARD.includes(bank);
