import { DOCUMENT, Injectable, inject } from '@angular/core';
import { isStaleBundleError } from '../utils/stale-bundle.util';

/**
 * Records that this session has already spent its one reload. `sessionStorage`
 * rather than `TmaStorageService`: the marker must die with the WebView, and
 * Telegram CloudStorage is both asynchronous and shared across the user's
 * devices, which is the opposite of what a per-session guard needs.
 */
const RELOAD_MARKER = 'transacto:stale-bundle-reloaded';

/**
 * Puts an app whose bundles were deleted underneath it back onto the current
 * deploy, by loading the page again.
 *
 * A reload is enough because `index.html` is served `no-cache` (see the
 * Caddyfile): fetching it again yields the names of the bundles that exist now.
 * Nothing subtler is available — the running app cannot repair itself, since
 * the code it would need is exactly what is missing.
 *
 * **At most once per session, and never without somewhere to record that.** A
 * WebView that reloads in a loop is worse than one stuck on a dead screen: the
 * user cannot read an error, cannot navigate, and in Telegram cannot easily
 * even close it.
 */
@Injectable({ providedIn: 'root' })
export class StaleBundleRecoveryService {
  private readonly document = inject(DOCUMENT);

  /**
   * Reloads if `error` is a stale-bundle failure and this session has not
   * reloaded yet. Returns whether a reload was started, so that a caller — and
   * the tests — can tell recovery from a failure left alone.
   *
   * `url` is the route the user was trying to reach. Loading it directly rather
   * than reloading the current page lets their tap finish: the router's default
   * `urlUpdateStrategy` leaves the address bar on the page they came from, so a
   * plain `reload()` would drop them back where they started and make them tap
   * again.
   */
  recover(error: unknown, url?: string): boolean {
    if (!isStaleBundleError(error)) return false;

    const view = this.document.defaultView;
    if (view === null) return false;
    if (!this.claimReload(view)) return false;

    const target = this.internalUrl(url);
    if (target === null) view.location.reload();
    else view.location.assign(target);

    return true;
  }

  /**
   * Takes this session's single reload, if it is still there. Read and write
   * are one operation on purpose: a storage that cannot be written is also one
   * that cannot stop the next failure reloading again, so an unavailable
   * `sessionStorage` — a locked-down WebView, private browsing — has to mean
   * "do not reload" rather than "reload freely".
   */
  private claimReload(view: Window): boolean {
    try {
      if (view.sessionStorage.getItem(RELOAD_MARKER) !== null) return false;
      view.sessionStorage.setItem(RELOAD_MARKER, '1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The router's own path, or `null` if it is anything else. `location.assign`
   * would happily follow `//example.com`, and a deep link is attacker-reachable
   * input, so only a single-slash absolute path is accepted.
   */
  private internalUrl(url?: string): string | null {
    if (url === undefined) return null;
    if (!url.startsWith('/')) return null;
    if (url.startsWith('//')) return null;
    return url;
  }
}
