import { Injectable } from '@angular/core';

/**
 * Telegram never answers a CloudStorage callback when the bridge is wedged, and
 * a promise that never settles would hang app boot. Losing the stored value is
 * survivable; a blank screen is not.
 */
const CLOUD_TIMEOUT_MS = 1_500;

/**
 * Keys CloudStorage will accept: 1–128 chars of `A-Z a-z 0-9 _ -`.
 *
 * Anything else is rejected through the callback's error argument, which this
 * service deliberately swallows — so an illegal key does not throw, it just
 * never persists. That combination hid a real bug (a `.` in the key), and the
 * guard below exists so the next one is loud instead.
 */
const CLOUD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The CloudStorage surface, taken from the SDK typing in `auth/services/tma.service.ts`. */
type TelegramCloudStorage = NonNullable<NonNullable<Window['Telegram']>['WebApp']['CloudStorage']>;

/**
 * Durable key/value storage for the Mini App.
 *
 * `Telegram.WebApp.CloudStorage` (Bot API 6.9+) is preferred because it follows
 * the user across their devices, but it does not exist in a browser during
 * `nx serve` nor in older clients, so `localStorage` backs it up — and that in
 * turn throws outright in some embedded webviews, hence the try/catch.
 *
 * Neither `get` nor `set` ever rejects: a storage failure must degrade to
 * "no stored preference", never break the caller.
 */
@Injectable({ providedIn: 'root' })
export class TmaStorageService {
  /**
   * CloudStorage, but only for a key it will actually accept.
   *
   * An illegal key silently falls back to `localStorage` alone rather than
   * pretending to sync, and says so — the failure mode this replaces was a
   * preference that appeared to save and never reached the user's other
   * devices.
   */
  private cloudFor(key: string): TelegramCloudStorage | undefined {
    const cloud = window.Telegram?.WebApp?.CloudStorage;
    if (!cloud) return undefined;

    if (!CLOUD_KEY_PATTERN.test(key)) {
      console.error(
        `[TmaStorageService] "${key}" is not a legal CloudStorage key (A-Z a-z 0-9 _ -); using localStorage only`,
      );

      return undefined;
    }

    return cloud;
  }

  /** The stored value, or `null` when nothing is stored or storage is unavailable. */
  async get(key: string): Promise<string | null> {
    const cloud = this.cloudFor(key);
    const fromCloud = cloud ? await this.readCloud(cloud, key) : null;

    return fromCloud ?? this.readLocal(key);
  }

  /**
   * The locally stored value, read synchronously.
   *
   * For the case where an immediate answer beats a complete one: `get` awaits
   * CloudStorage, which can take up to {@link CLOUD_TIMEOUT_MS}, and a
   * component that renders a default first and corrects itself afterwards
   * visibly jumps. Because `set` always writes locally too, this is already
   * correct on any device the user has actually made the choice on — the cloud
   * round trip only adds anything on a *different* device's first visit, which
   * the caller can reconcile in the background.
   */
  getLocal(key: string): string | null {
    return this.readLocal(key);
  }

  /**
   * Writes to both backends. The local copy is not just a fallback for clients
   * without CloudStorage — it also keeps the value readable when a later
   * CloudStorage read errors out.
   */
  async set(key: string, value: string): Promise<void> {
    const cloud = this.cloudFor(key);
    if (cloud) await this.writeCloud(cloud, key, value);

    this.writeLocal(key, value);
  }

  private readCloud(cloud: TelegramCloudStorage, key: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[TmaStorageService] CloudStorage.getItem timed out');
        resolve(null);
      }, CLOUD_TIMEOUT_MS);

      const settle = (value: string | null): void => {
        clearTimeout(timer);
        resolve(value);
      };

      try {
        cloud.getItem(key, (error, value) => settle(error || !value ? null : value));
      } catch (error) {
        console.warn('[TmaStorageService] CloudStorage.getItem threw', error);
        settle(null);
      }
    });
  }

  private writeCloud(cloud: TelegramCloudStorage, key: string, value: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[TmaStorageService] CloudStorage.setItem timed out');
        resolve();
      }, CLOUD_TIMEOUT_MS);

      const settle = (): void => {
        clearTimeout(timer);
        resolve();
      };

      try {
        cloud.setItem(key, value, (error) => {
          if (error) console.warn('[TmaStorageService] CloudStorage.setItem failed', error);
          settle();
        });
      } catch (error) {
        console.warn('[TmaStorageService] CloudStorage.setItem threw', error);
        settle();
      }
    });
  }

  private readLocal(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[TmaStorageService] localStorage.getItem unavailable', error);

      return null;
    }
  }

  private writeLocal(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('[TmaStorageService] localStorage.setItem unavailable', error);
    }
  }
}
