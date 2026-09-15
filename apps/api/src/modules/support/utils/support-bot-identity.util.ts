/**
 * Which bot the support module talks as.
 *
 * The distinction is not cosmetic, and it is worth stating why this file
 * exists. `initData` is signed by the bot that launched the Mini App, and
 * `TmaAuthService` verifies it with `TELEGRAM_BOT_TOKEN` — so that variable
 * belongs to the Mini App's bot and to nothing else. Putting a second bot's
 * token there logs every user out with `Invalid initData hash`, on every
 * request, with no clue as to why. It has happened once already.
 *
 * So support takes its own variable and falls back to the Mini App's only when
 * it genuinely is the same bot.
 */
export const resolveSupportBotToken = (
  supportToken: string | undefined,
  miniAppToken: string | undefined
): string => supportToken?.trim() || miniAppToken?.trim() || ''
