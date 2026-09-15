import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { ApiError } from '@transacto/contracts';

/** Fallback when the failure carries no code we recognise. */
const GENERIC_KEY = 'common.error';

/**
 * Turns a failed API call into a message in the trader's language.
 *
 * The backend answers with `{ code, message }` from its `ERROR` map. The
 * `message` is developer-facing and English-only, so it is deliberately never
 * displayed — the numeric `code` selects an `ERRORS.<code>` translation instead.
 */
@Injectable({ providedIn: 'root' })
export class ApiErrorService {
  private readonly translate = inject(TranslateService);

  /**
   * The `ERROR` code a failure carries, or `null`.
   *
   * Exposed because a screen sometimes has to *do* something about one
   * particular refusal rather than only say it — the create form offers a way
   * out of a moved rate — and reading the shape by hand at each call site is
   * how a second, subtly different reading of it appears.
   */
  codeOf(error: unknown): number | null {
    const code = (error as { error?: Partial<ApiError> })?.error?.code;

    return typeof code === 'number' ? code : null;
  }

  messageFor(error: unknown, fallbackKey: string = GENERIC_KEY): string {
    const code = this.codeOf(error);

    if (code !== null) {
      const key = `ERRORS.${code}`;
      const translated = this.translate.instant(key);
      // ngx-translate echoes the key back when it has no entry
      if (translated !== key) return translated;

      console.warn(`[ApiErrorService] no translation for ${key}`);
    }

    return this.translate.instant(fallbackKey);
  }
}
