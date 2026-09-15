/**
 * Escapes text for Telegram's `HTML` parse mode.
 *
 * Only three characters need it, per Telegram's documentation, and getting it
 * wrong is not cosmetic: a user whose first name contains `<` would make every
 * intro card fail to send with a 400, and one who chose a name like
 * `<a href="…">` would be injecting markup into a message admins read as ours.
 *
 * Names are the reason this exists, so it is applied to every value that came
 * from a user before it reaches a formatted message.
 */
export const escapeTelegramHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
