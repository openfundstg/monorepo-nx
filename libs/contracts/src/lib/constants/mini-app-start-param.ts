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
