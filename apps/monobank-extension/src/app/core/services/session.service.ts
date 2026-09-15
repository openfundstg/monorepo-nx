import { Injectable, signal } from '@angular/core';

/** Keys under which the session lives in `chrome.storage.local`. */
const STORAGE_KEYS = {
  TOKEN: 'X-API-TOKEN',
  TRADER_ID: 'traderId',
} as const;

/**
 * The signed-in trader, and nothing else.
 *
 * Deliberately free of HTTP so `apiTokenInterceptor` can read the token without
 * depending on the service that performs logins — which would inject
 * `HttpClient` and make the interceptor part of its own dependency cycle.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly token = signal<string | null>(null);
  readonly traderId = signal<string | null>(null);

  /** True until `chrome.storage` has been read; guards wait on it. */
  readonly isInitializing = signal<boolean>(true);

  constructor() {
    void this.restore();
  }

  set(token: string, traderId: string): void {
    this.token.set(token);
    this.traderId.set(traderId);
  }

  async clear(): Promise<void> {
    await chrome.storage.local.clear();
    this.token.set(null);
    this.traderId.set(null);
  }

  async persist(token: string, traderId: string): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEYS.TOKEN]: token,
      [STORAGE_KEYS.TRADER_ID]: traderId,
    });
    this.set(token, traderId);
  }

  private async restore(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.TOKEN, STORAGE_KEYS.TRADER_ID]);
      const token = stored[STORAGE_KEYS.TOKEN] as string | undefined;
      const traderId = stored[STORAGE_KEYS.TRADER_ID] as string | undefined;

      if (token && traderId) this.set(token, traderId);
    } catch (err) {
      console.error('Error reading from storage:', err);
    } finally {
      this.isInitializing.set(false);
    }
  }
}
