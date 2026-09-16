import { Injectable } from '@angular/core'
import type { PreloadingStrategy, Route } from '@angular/router'
import { firstValueFrom, from, type Observable } from 'rxjs'

const Preload = {
  /** Leave the first screen and its own Tor requests alone this long before any chunk starts. */
  WARMUP_MS: 4000,
  /** Fire the next chunk after at most this idle wait, even if the thread never fully settles. */
  IDLE_TIMEOUT_MS: 3000,
  /** Fallback gap where `requestIdleCallback` is unavailable (older WebViews). */
  FALLBACK_MS: 300
} as const

/**
 * Preloads lazy route chunks — but late, and one at a time.
 *
 * The origin is reached only over a Tor onion, where the bottleneck is
 * bandwidth, not the round trip: a component chunk is far larger than an API
 * response, and everything shares that one slow pipe. Angular's stock
 * `PreloadAllModules` would start every chunk the instant the first route
 * resolves and elbow the dashboard's own calls — rates, profile — off the wire,
 * which is the opposite of what a new user needs. So this waits ~4s for the
 * first screen to settle, then walks the chunks **sequentially**, each fired
 * only when the main thread is idle. By the time a user taps into a section its
 * bundle is already cached, and the hashed-immutable Caddy headers keep it
 * cached for the next launch.
 *
 * A class, not a functional provider: `withPreloading` takes a
 * `PreloadingStrategy` type and Angular offers no functional form. Preloading
 * only fetches the code; it never activates the route, so `tmaGuard` still runs
 * on real navigation and nothing is rendered ahead of the launch verdict.
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloadStrategy implements PreloadingStrategy {
  /** One serial chain, so chunks download after one another rather than all at once. */
  private queue: Promise<unknown> = new Promise<void>((resolve) => setTimeout(resolve, Preload.WARMUP_MS))

  preload(_route: Route, load: () => Observable<unknown>): Observable<unknown> {
    const run = this.queue
      .then(() => this.whenIdle())
      .then(() => firstValueFrom(load(), { defaultValue: null }))
      .catch(() => null)
    this.queue = run

    return from(run)
  }

  private whenIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      const idle = (
        globalThis as typeof globalThis & {
          requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
        }
      ).requestIdleCallback
      if (typeof idle === 'function') idle(() => resolve(), { timeout: Preload.IDLE_TIMEOUT_MS })
      else setTimeout(resolve, Preload.FALLBACK_MS)
    })
  }
}
