/**
 * Support-bot vocabulary that crosses the wire.
 *
 * These two started backend-only, on the stated grounds that "no browser or
 * Mini App ever sees a support topic". The admin panel does — it lists topics
 * and the people behind them — so they belong here now, with the backend
 * keeping a re-export bridge so its existing importers are untouched.
 *
 * `SupportTopicTitleState` deliberately stayed behind: it records what was last
 * written into a Telegram topic title so a rename happens exactly on a change.
 * That is a fact about our conversation with Telegram, not about the support
 * thread, and no client has any use for it.
 */

/**
 * Whether a user's forum topic is currently visible in the support group.
 *
 * `CLOSED` is Telegram's own notion of a closed forum topic — hidden from the
 * group's topic list, but not deleted, and reopened the moment its owner writes
 * again. The mapping row survives either way.
 */
export enum SupportTopicStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * The languages the bot speaks, matching the Mini App's own dictionaries in
 * `apps/telegram-mini-app/src/assets/i18n`.
 *
 * A user's chosen language is stored, so a locale the database holds but a
 * dictionary does not is a crash waiting for whoever removes a language.
 */
export enum SupportLocale {
  UK = 'uk',
  RU = 'ru',
  EN = 'en',
}
