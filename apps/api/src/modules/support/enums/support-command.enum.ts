/**
 * The commands this bot answers.
 *
 * Matched on the first whitespace-delimited word so `/close done for today` and
 * `/start@transacto_bot` both land, the latter being what Telegram sends when a
 * command is typed in a group where more than one bot is present.
 */
export enum SupportCommand {
  /** Sent by Telegram when a user opens the bot chat and presses Start. */
  START = '/start',
  /** An admin, inside a topic: hide this conversation until its owner writes again. */
  CLOSE = '/close'
}
