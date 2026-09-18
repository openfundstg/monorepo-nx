/**
 * `startapp` payloads the Mini App acts on, as opposed to the ones it ignores.
 *
 * A `startapp` payload is free text on a `t.me` link, and this product already
 * spends it on referral codes — so a second use of it has to be a value no
 * referral code can be. Codes are eight characters of the public-id alphabet;
 * these are lower-case words, which that alphabet does not produce.
 *
 * Here rather than in either app because both ends are involved and they must
 * agree exactly: the bot writes the link, the Mini App reads what came back
 * through Telegram's signed `initData`. A literal on each side would be a typo
 * away from a button that silently lands on the dashboard.
 */
export const MiniAppStartParam = {
  /**
   * Open straight on the hryvnia top-up amounts.
   *
   * Sent on the bot's "a sum you asked for has appeared" message, where the
   * whole point is speed: the amount is a payout another trader can take, and
   * an extra two taps is how somebody misses it.
   */
  TOP_UP: 'topup',
} as const;

export type MiniAppStartParam = (typeof MiniAppStartParam)[keyof typeof MiniAppStartParam];

/**
 * The prefix a "open this sale" payload carries.
 *
 * An underscore, which is the point: `startapp` allows `A-Za-z0-9_-`, and a
 * referral code is eight characters of the public-id alphabet — letters and
 * digits only. So a payload containing one of these can never be read as a
 * code, and a code can never be read as a sale.
 */
export const SALE_START_PARAM_PREFIX = 'sale_';

/** A sale id, as the id of a Mongo document: 24 hexadecimal characters. */
const SALE_ID_PATTERN = /^[0-9a-f]{24}$/;

/**
 * The `startapp` payload that opens one sale's status screen.
 *
 * The bot writes it onto its *Open the sale* key, the Mini App reads it back
 * out of Telegram's signed `initData`. Without a payload the key is a link to
 * a bot chat — which is where the person pressing it already is, so it looked
 * to them like a button that does nothing.
 */
export const saleStartParam = (saleId: string): string =>
  `${SALE_START_PARAM_PREFIX}${saleId}`;

/**
 * The sale behind a launch payload, or `null` when it is about something else.
 *
 * Validated rather than merely unprefixed: whatever comes back becomes a route
 * segment, and a payload is free text a person can type into a link. An id
 * that is not an id is not a sale, and navigating to it would ask the API
 * about a document that cannot exist.
 */
export const saleIdFromStartParam = (param: string): string | null => {
  if (!param.startsWith(SALE_START_PARAM_PREFIX)) return null;

  const saleId = param.slice(SALE_START_PARAM_PREFIX.length);

  return SALE_ID_PATTERN.test(saleId) ? saleId : null;
};
