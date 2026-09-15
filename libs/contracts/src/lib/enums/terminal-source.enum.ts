/**
 * How a terminal came into existence.
 *
 * Both kinds are created through the Transacto API, so this is not something
 * the upstream API tells us — we classify by the name the Mini App gives its
 * terminals, which is why {@link TMA_TERMINAL_NAME_PREFIX} is a contract rather
 * than a local string.
 */
export enum TerminalSource {
  /** Created by the trader in the Transacto admin panel. */
  TRANSACTO = 'TRANSACTO',
  /** Created automatically by a Telegram Mini App sale. */
  TMA = 'TMA',
}

/**
 * Prefix the Mini App puts on every terminal it creates.
 *
 * The full name is `TMA-<publicId>` — the sale's own public id, so the
 * code a user quotes to support is the same string that identifies the terminal
 * in the Transacto panel. (The telegramId travels in the credential's separate
 * `name` field, which is what it was for.)
 *
 * The backend classifies terminals by this prefix on every sync, so changing it
 * here silently reclassifies existing terminals — don't, without a migration.
 * Only the prefix is load-bearing: `classifyTerminalSource` does `startsWith`
 * and nothing anywhere parses the suffix.
 */
export const TMA_TERMINAL_NAME_PREFIX = 'TMA-';
