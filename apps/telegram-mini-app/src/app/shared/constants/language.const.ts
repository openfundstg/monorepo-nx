import { AppLanguage } from '../enums/app-language.enum';

/** Ukrainian is the primary market, so it is the fallback. */
export const DEFAULT_LANGUAGE = AppLanguage.UK;

/**
 * Where the manually chosen language is persisted.
 *
 * The same key is used for Telegram CloudStorage and for the `localStorage`
 * fallback, so a client that later gains CloudStorage keeps reading the choice
 * it made before.
 *
 * **Underscore, not a dot.** CloudStorage keys are restricted to `A-Z a-z 0-9 _
 * -`; a `.` makes every write fail. The failure is silent — the callback simply
 * reports an error the wrapper swallows — so the symptom is not an exception
 * but a preference that never syncs to the user's other devices.
 */
export const LANGUAGE_STORAGE_KEY = 'app_language';
