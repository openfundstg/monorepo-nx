/** Languages with a dictionary in `assets/i18n`. */
export enum AppLanguage {
  UK = 'uk',
  EN = 'en',
  RU = 'ru',
}

/**
 * The picker's rows, in display order.
 *
 * The names are **endonyms** — each language written in itself — and are
 * deliberately NOT translation keys. A picker that translates its own options
 * shows "Ukrainian / English / Russian" to someone who cannot read the current
 * language, which is exactly the person who came here to change it. Do not
 * "fix" this by moving the names into `assets/i18n`.
 */
export const APP_LANGUAGES = [
  { code: AppLanguage.UK, endonym: 'Українська', flag: '🇺🇦' },
  { code: AppLanguage.EN, endonym: 'English', flag: '🇬🇧' },
  { code: AppLanguage.RU, endonym: 'Русский', flag: '🇷🇺' },
] as const;

export type AppLanguageOption = (typeof APP_LANGUAGES)[number];
