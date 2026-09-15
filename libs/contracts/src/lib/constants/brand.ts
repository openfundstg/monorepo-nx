/**
 * The product's public channel on Telegram.
 *
 * Here rather than in each app's own constants because the bot and the Mini App
 * both point at it, and a channel is exactly the kind of address that gets
 * moved once and updated in one of the two places. The brand *name* is already
 * written out twice — `BRAND` in the support dictionaries and `BRAND_NAME` in
 * the Mini App — which is the shape of mistake this avoids rather than the
 * precedent to copy.
 *
 * Not an environment variable: it is the same channel in development as in
 * production, and a value that never differs between configurations is a
 * constant that would only ever be a way to deploy the wrong link.
 *
 * A `t.me` address, so the Mini App must open it through
 * `TmaService.openTelegramLink` rather than `window.open` — inside Telegram's
 * WebView the latter lands on t.me's own "open in Telegram" page instead of the
 * channel.
 */
export const OFFICIAL_CHANNEL_URL = 'https://t.me/OpenFundss';
