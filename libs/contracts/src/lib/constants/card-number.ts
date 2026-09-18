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

/** How many trailing digits of a card this product is willing to keep. */
export const CARD_TAIL_LENGTH = 4;

/**
 * The last four digits of a card, or an empty string if there are not four.
 *
 * **This is the only part of a card a sale stores.** Nothing in this codebase
 * persists a full PAN: a sale's card goes straight to Transacto as `cred` and is
 * never written down, which is why `terminals` keeps `cred3` and no `cred`. A
 * card sale needs to recognise its own payout account on a bank statement and to
 * name it on screen, and four digits do both — while sixteen would put a payment
 * credential at rest in exchange for nothing either job needs.
 *
 * Four digits are not proof of a card, in the sense {@link matchesMaskedCard}
 * spells out. They are enough to refuse a statement that is plainly for a
 * different account, which is what they are asked to do.
 *
 * An empty result never matches anything — an unknown card must not satisfy a
 * check whose purpose is to prove the card is known.
 */
export const cardTail = (value: string): string => {
  const digits = cardDigits(value);

  return digits.length >= CARD_TAIL_LENGTH ? digits.slice(-CARD_TAIL_LENGTH) : '';
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

/** How many digits a bank prints between spaces. */
const GROUP_SIZE = 4;

/** Every group that still has a digit after it — the ones a space follows. */
const GROUPS = new RegExp(`(.{${GROUP_SIZE}})(?=.)`, 'g');

/**
 * A card number grouped the way it is printed on the card.
 *
 * Takes whatever is in the field — digits, half-typed groups, a number pasted
 * with dashes — and returns `0000 0000 0000 0000`, never longer than a card.
 * Non-digits are dropped rather than rejected, because the commonest way to
 * fill this field is a paste out of a banking app, and those arrive spaced,
 * dashed or run together depending on the app.
 *
 * Grouping is not decoration. Sixteen unbroken digits cannot be checked against
 * a card by eye, and a typo in the middle of them is invisible — which on this
 * screen means hryvnia routed to an account the seller does not hold.
 *
 * Lives here because the mask and {@link cardDigits} have to agree about what a
 * card is: the field shows what this returns and submits what that strips.
 */
export const formatCardNumber = (value: string): string => {
  const digits = cardDigits(value).slice(0, CARD_NUMBER_LENGTH);

  return digits.replace(GROUPS, '$1 ');
};

/**
 * Whether a card number's own check digit agrees with the rest of it.
 *
 * The Luhn checksum, which every card in issue satisfies: the digits are summed
 * right to left, every second one doubled (and reduced by nine when that passes
 * nine), and a valid number is a multiple of ten.
 *
 * **It catches typos, and claims nothing else.** A number passing this may name
 * no account at all — Luhn is a transcription check, not an existence check, so
 * it can only ever refuse a card, never confirm one. What it refuses is the case
 * this product cannot afford to accept quietly: a single mistyped or transposed
 * digit, which is exactly what Luhn was designed to catch and what would
 * otherwise send somebody's payout to a number that is not theirs.
 *
 * A length other than {@link CARD_NUMBER_LENGTH} is not valid here even where
 * the checksum would pass — the field is for Ukrainian cards, which are sixteen
 * digits, and a shorter string is an unfinished one rather than another scheme.
 *
 * Shared so the form and the server refuse the same numbers. A client stricter
 * than the backend blocks a card that would have worked; a client looser than it
 * lets a user fill in a whole form to be turned away at the end.
 */
export const isLuhnValid = (value: string): boolean => {
  const digits = cardDigits(value);

  if (digits.length !== CARD_NUMBER_LENGTH) return false;

  const sum = [...digits].reduce((total, character, index) => {
    const digit = Number(character);
    // Counting from the right: with an even length, the doubled positions are
    // the even indices from the left.
    const doubled = index % 2 === 0 ? digit * 2 : digit;

    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);

  return sum % 10 === 0;
};
