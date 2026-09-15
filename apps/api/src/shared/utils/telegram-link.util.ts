/**
 * Telegram's own link host. Hardcoded deliberately: it is a vendor address, the
 * same for every deployment, and pointing it elsewhere would only produce a
 * link that does not open Telegram.
 */
export const TELEGRAM_LINK_BASE = 'https://t.me'

/**
 * A link that opens this product's Mini App, optionally with a payload.
 *
 * `startapp` — not `start` — is what launches the Mini App directly; `start`
 * opens a bot chat instead. The payload comes back to the app inside Telegram's
 * signed `initData`, which is what makes it worth carrying anything in.
 *
 * Pure, and takes the username rather than reading it: `src/shared/**` knows
 * nothing about configuration, and both callers already have to decide what to
 * do when the username is not set — one refuses, the other drops a button.
 */
export const miniAppLink = (botUsername: string, startParam?: string): string => {
  const handle = botUsername.trim().replace(/^@/, '')

  return startParam === undefined
    ? `${TELEGRAM_LINK_BASE}/${handle}`
    : `${TELEGRAM_LINK_BASE}/${handle}?startapp=${startParam}`
}
