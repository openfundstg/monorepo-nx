/** Everything that is not a digit — grouping spaces, dashes, stray whitespace. */
const NON_DIGITS = /\D/g;

/** Ukrainian bank cards are sixteen digits. */
export const CARD_NUMBER_LENGTH = 16;

/** A card number with the spacing a human typed stripped back off. */
export const cardDigits = (value: string): string => value.replace(NON_DIGITS, '');

/**
 * Whether two card numbers are the same card.
 *
 * Compared as digits only. A user types "5168 7500 0000 3407" while the bank
 * reports "5168750000003407", and a string comparison would call two spellings
 * of one card a mismatch — which, on a check that refuses an order, is the
 * expensive direction to be wrong in.
 *
 * Two empty strings are not a match: an unknown card must never satisfy a check
 * whose whole purpose is to prove the card is known.
 *
 * **It lives here so the form and the server cannot disagree**, exactly as
 * {@link isGoalWithinTolerance} does. A client that accepted a pair the server
 * refuses would let a user submit an order that is rejected the moment it
 * arrives; one that refused a pair the server accepts would block an order that
 * was set up correctly. Both were reachable while this existed only on the
 * backend.
 */
export const isSameCardNumber = (left: string, right: string): boolean => {
  const a = cardDigits(left);
  const b = cardDigits(right);

  return a.length > 0 && a === b;
};

/** What a bank prints where it will not show a digit. */
const MASK_CHARACTER = '*';

/**
 * Whether a typed card can be the one behind a bank's mask.
 *
 * Some banks name the card their link pays into (PrivatBank) and some name
 * nothing (Monobank). PUMB does a third thing: it publishes the card
 * **partially** — `53552800****0000`, twelve of sixteen digits. That is not
 * proof of a card, but it is proof enough to refuse a wrong one at creation
 * instead of discovering it three dead orders later.
 *
 * Compared position by position against the mask's own shape rather than
 * against an assumed "first eight, last four": how much a bank chooses to
 * reveal is theirs to change, and a matcher that hard-coded today's split would
 * start rejecting every card the day they revealed one digit fewer.
 *
 * **Four unknown digits are ten thousand possibilities, not one.** A match here
 * says "not obviously the wrong card", never "the right card" — which is why a
 * masking bank keeps the dead-order fraud rule that a disclosing bank skips.
 *
 * Lives here so the form and the server cannot disagree, exactly as
 * {@link isSameCardNumber} does.
 */
export const matchesMaskedCard = (typed: string, mask: string): boolean => {
  const digits = cardDigits(typed);
  const pattern = mask.trim();

  if (digits.length !== CARD_NUMBER_LENGTH || pattern.length !== CARD_NUMBER_LENGTH) return false;

  return [...pattern].every(
    (character, index) => character === MASK_CHARACTER || character === digits[index],
  );
};
