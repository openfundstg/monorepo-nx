import { PUBLIC_ID_PATTERN } from './public-id.js';

/**
 * A referral code has exactly the shape of a sale's public id — eight
 * characters of digits and uppercase Latin letters — and is produced by the same
 * generator.
 *
 * Aliased rather than redeclared so the two can never drift into different
 * lengths or alphabets, and named separately because a referral code is a
 * different thing from an order id: it is typed by a human into the "enter a
 * friend's code" field, so the client validates against this name and the
 * backend DTO matches on it.
 */
export const REFERRAL_CODE_PATTERN = PUBLIC_ID_PATTERN;

/**
 * Characters of the stable pseudonym shown in place of a referral who has not
 * opted into revealing their name.
 *
 * Six hex characters — 16.7 million values — so two rows in one referrer's list
 * colliding is negligible, while the label stays short enough to read as an
 * identifier rather than a hash.
 */
export const REFERRAL_MASKED_ID_LENGTH = 6;
