import { Injectable, signal } from '@angular/core';

/** How often a running app asks whether it is still the current one. */
const CHECK_INTERVAL_MS = 60_000;

/**
 * The entry bundle's filename, as the built `index.html` references it.
 *
 * `main-KJBQSQ6Q.js` in production, where the hash is the content's own — and
 * plain `main.js` in development, where nothing is hashed and this therefore
 * never changes. Both are matched; the second simply never triggers anything,
 * which is the right behaviour for a dev server.
 */
const ENTRY_BUNDLE = /src="(main[^"]*\.js)"/;

/**
 * Whether the app on screen is still the app we ship.
 *
 * **The version is the entry bundle's content hash**, read out of the live
 * `index.html`. Nothing is generated at build time and no version constant is
 * maintained anywhere: the hash changes exactly when the bundle changes, which
 * is the definition of a new release, and a number somebody has to remember to
 * bump is a number that eventually is not bumped.
 *
 * This works because of a decision already made at the edge — `index.html` is
 * served `no-cache` while the hashed bundles are `immutable` (see the Caddyfile
 * note in the root `CLAUDE.md`). Asking for it again therefore reaches the
 * origin rather than the WebView's cache, which is the same property that stops
 * Telegram pinning users to a stale build for days.
 *
 * A failed check changes nothing. Being briefly unsure which version is current
 * is normal — a train, a lift — and locking somebody out of a screen because
 * their connection blinked would be a worse product than a minute of staleness.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  /**
   * Set once, and never unset.
   *
   * There is no path back: the code that would have to decide the update no
   * longer applies is the old code, which is precisely what is out of date. The
   * only exit is a reload.
   */
  private readonly _updateRequired = signal(false);

  readonly updateRequired = this._updateRequired.asReadonly();

  /** The bundle this running app was loaded from; `null` until known. */
  private loadedBundle: string | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Records what is running now, then watches for it to be superseded.
   *
   * The baseline is read from the same place as every later check, rather than
   * from anything compiled in: two different sources for "which version is
   * this" is how a check comes to compare a build number against a file hash
   * and fire on every load.
   */
  async start(): Promise<void> {
    if (this.timer !== null) return;

    this.loadedBundle = await this.currentBundle();

    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);

    // A Mini App spends most of its life backgrounded, where timers are
    // throttled or stopped outright. Coming back to the foreground is both the
    // moment a check is most likely to be overdue and the moment the user is
    // about to act on whatever the screen says.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
  }

  /** Asks once. Safe to call as often as anything likes. */
  async check(): Promise<void> {
    if (this._updateRequired() || this.loadedBundle === null) return;

    const current = await this.currentBundle();
    if (current === null || current === this.loadedBundle) return;

    this._updateRequired.set(true);
  }

  /**
   * Reloads onto the new build.
   *
   * A plain reload is enough precisely because of the caching split: the
   * document is `no-cache`, so the browser fetches the new `index.html`, and
   * the bundles it names are ones this client has never seen.
   */
  reload(): void {
    location.reload();
  }

  /**
   * The entry bundle the origin is serving right now, or `null` when the
   * question could not be answered.
   *
   * `no-store` rather than trusting the header: this is the one request in the
   * app whose whole purpose is to bypass a cache, and the WebView's idea of
   * `no-cache` is not something to stake a forced reload on.
   */
  private async currentBundle(): Promise<string | null> {
    try {
      const response = await fetch(new URL('index.html', document.baseURI), {
        cache: 'no-store',
      });
      if (!response.ok) return null;

      return ENTRY_BUNDLE.exec(await response.text())?.[1] ?? null;
    } catch {
      return null;
    }
  }
}
