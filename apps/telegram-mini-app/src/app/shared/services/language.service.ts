import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { APP_LANGUAGES, AppLanguage } from '../enums/app-language.enum';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from '../constants/language.const';
import { TmaStorageService } from './tma-storage.service';

/** Some Telegram clients send the deprecated "ua" for Ukrainian. */
const LEGACY_UK_CODE = 'ua';

/**
 * Owns the active interface language.
 *
 * A choice made on the settings screen is **sticky**: it wins over Telegram's
 * `language_code` on every subsequent open, because a user who switched to
 * English inside a Ukrainian-locale client meant it.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly storage = inject(TmaStorageService);

  readonly current = signal<AppLanguage>(DEFAULT_LANGUAGE);

  /** The picker's rows — endonyms, deliberately untranslated. */
  readonly languages = APP_LANGUAGES;

  /**
   * Resolves the language to boot with: the stored choice if there is one,
   * otherwise whatever Telegram reports, otherwise the default.
   */
  async init(telegramLanguageCode?: string): Promise<void> {
    const stored = this.toAppLanguage(await this.storage.get(LANGUAGE_STORAGE_KEY));

    this.apply(stored ?? this.resolve(telegramLanguageCode));
  }

  /** Switches the language and remembers it. */
  async use(language: AppLanguage): Promise<void> {
    this.apply(language);

    await this.storage.set(LANGUAGE_STORAGE_KEY, language);
  }

  private apply(language: AppLanguage): void {
    this.current.set(language);
    this.translate.use(language);
  }

  /** Telegram sends BCP-47 ("en-GB"), and "ua" in place of "uk" from some clients. */
  private resolve(languageCode?: string): AppLanguage {
    const base = (languageCode ?? '').toLowerCase().split('-')[0];
    const normalised = base === LEGACY_UK_CODE ? AppLanguage.UK : base;

    return this.toAppLanguage(normalised) ?? DEFAULT_LANGUAGE;
  }

  private toAppLanguage(value: string | null): AppLanguage | null {
    return APP_LANGUAGES.some((option) => option.code === value)
      ? (value as AppLanguage)
      : null;
  }
}
