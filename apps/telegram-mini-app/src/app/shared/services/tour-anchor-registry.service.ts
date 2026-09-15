import { Injectable, signal } from '@angular/core'
import { TourStep } from '../enums/tour-step.enum'

/**
 * Which element on screen each tour step points at, right now.
 *
 * DOM bookkeeping and nothing else — no step order, no copy, no persistence;
 * those are the onboarding module's. It holds state in `shared/` for the same
 * reason `LoadingService` does: two unrelated templates (the dashboard and the
 * bottom nav) have to write into it and one overlay has to read it, and
 * `shared/` is the only folder all three may import.
 *
 * A signal over an immutable `Map`, so the overlay re-anchors the moment an
 * element appears — the balance card inside the dashboard's loading `@else`,
 * for instance — and degrades to a centred card the moment it goes.
 */
@Injectable({ providedIn: 'root' })
export class TourAnchorRegistryService {
  private readonly _anchors = signal<ReadonlyMap<TourStep, HTMLElement>>(new Map())

  /** Every mounted anchor, keyed by step. A new Map on every change, never mutated. */
  readonly anchors = this._anchors.asReadonly()

  /** Points the step at `element`, replacing whatever it pointed at before. */
  register(step: TourStep, element: HTMLElement): void {
    this._anchors.update((current) => new Map(current).set(step, element))
  }

  /**
   * Forgets the step — but only if it still points at `element`.
   *
   * Angular does not promise that an old instance is destroyed before its
   * replacement is initialised, so an unconditional delete could evict the
   * newer registration and leave a step unanchored while its element is on
   * screen.
   */
  unregister(step: TourStep, element: HTMLElement): void {
    if (this._anchors().get(step) !== element) return

    this._anchors.update((current) => {
      const next = new Map(current)
      next.delete(step)
      return next
    })
  }

  /** The element for a step, or `null`. Tracked when read inside a `computed`. */
  anchorFor(step: TourStep): HTMLElement | null {
    return this._anchors().get(step) ?? null
  }
}
