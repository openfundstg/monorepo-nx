import { Injectable, computed, inject, signal } from '@angular/core'
import { TmaStorageService } from '../../shared/services/tma-storage.service'
import { TourAnchorRegistryService } from '../../shared/services/tour-anchor-registry.service'
import { AppVersionService } from '../../shared/services/app-version.service'
import { SessionExpiryService } from '../../auth/services/session-expiry.service'
import { TourStoredState } from '../enums/tour-stored-state.enum'
import { TOUR_READY_ANCHOR, TOUR_STEPS, TOUR_STORAGE_KEY } from '../constants/tour.const'

/**
 * The onboarding tour: which step is up, whether it is due, and what storage
 * remembers about it.
 *
 * It never decides to *show* anything. `active` is derived: the tour is due
 * (marked pending for a new account, or asked for from Settings) AND the
 * dashboard's balance card is registered AND neither blocking screen is up.
 * So it cannot paint over the dashboard's spinner, cannot appear on a
 * deep-linked top-up screen, hides when the user leaves the home screen and
 * resumes when they return — with no page calling anything.
 *
 * Persistence mirrors `GuidePreferenceService`: a synchronous local read seeds
 * the first paint, the cloud is reconciled afterwards, and a choice the user
 * makes while that read is in flight outranks it.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingTourService {
  private readonly storage = inject(TmaStorageService)
  private readonly registry = inject(TourAnchorRegistryService)
  private readonly version = inject(AppVersionService)
  private readonly session = inject(SessionExpiryService)

  /** The stops, in order; `total` is what "{{current}} of {{total}}" counts to. */
  readonly steps = TOUR_STEPS
  readonly total = TOUR_STEPS.length

  private readonly _stepIndex = signal(0)
  /** Position in {@link TOUR_STEPS}. Memory only: survives navigation, not a relaunch. */
  readonly stepIndex = this._stepIndex.asReadonly()
  /** The stop the overlay is rendering. A fresh object per index, so a reader re-runs per step. */
  readonly step = computed(() => this.steps[this._stepIndex()])
  /** One-based, for the progress line. */
  readonly stepNumber = computed(() => this._stepIndex() + 1)
  /** Back is hidden on the first step and Next reads "Got it" on the last. */
  readonly isFirst = computed(() => this._stepIndex() === 0)
  readonly isLast = computed(() => this._stepIndex() === this.total - 1)

  /**
   * Seeded from the synchronous local read so the first paint is right;
   * `reconcileWithCloud` corrects it for a device the user has never used.
   */
  private readonly stored = signal<TourStoredState | null>(
    this.toStoredState(this.storage.getLocal(TOUR_STORAGE_KEY))
  )

  /** Settings asked for a replay. In memory only — an abandoned replay must not return. */
  private readonly requested = signal(false)

  /** "The tour wants to run": marked pending, or explicitly asked for. */
  readonly due = computed(() => this.requested() || this.stored() === TourStoredState.PENDING)

  /**
   * True only while the overlay should be painted.
   *
   * The balance card is the dashboard's "loaded" signal (see
   * {@link TOUR_READY_ANCHOR}); the two latches keep the tour's key handlers and
   * focus moves from running under the update or session-expired screens,
   * which paint over it at z-index 1000.
   */
  readonly active = computed(
    () =>
      this.due() &&
      this.registry.anchorFor(TOUR_READY_ANCHOR) !== null &&
      !this.version.updateRequired() &&
      !this.session.expired()
  )

  /**
   * Set the moment the user (or the auth effect) does anything.
   *
   * The cloud read is in flight for up to 1.5 s after launch — long enough to
   * skip the tour first — and a reconcile landing afterwards must not undo
   * that. Checked *after* the await in {@link reconcileWithCloud}.
   */
  private userHasActed = false

  /**
   * Writes, one after another.
   *
   * `TmaStorageService.set` awaits the cloud (up to 1.5 s) and only then writes
   * `localStorage`. Two overlapping calls — `pending` at `/auth`, `done` on a
   * quick Skip — can therefore land locally in the wrong order if the first
   * times out and the second does not. Chaining makes the last one issued the
   * last one written, on both backends.
   */
  private writeChain: Promise<void> = Promise.resolve()

  constructor() {
    void this.reconcileWithCloud()
  }

  /**
   * Called by `armOnboardingTour` on the launch that created the account.
   *
   * Written at `/auth` time rather than when the tour starts: a new user
   * deep-linked straight to the top-up list who closes the app there has
   * `isNewUser: false` on every later launch, and the tour would be lost.
   */
  markPending(): void {
    this.userHasActed = true
    this.stored.set(TourStoredState.PENDING)
    this.write(TourStoredState.PENDING)
  }

  /** Settings → "Show the tour again". Starts from the first step; writes nothing. */
  replay(): void {
    this.userHasActed = true
    this._stepIndex.set(0)
    this.requested.set(true)
  }

  /** One step on; on the last step, the end of the tour. */
  next(): void {
    this.userHasActed = true
    if (this.isLast()) {
      this.conclude()
      return
    }
    this._stepIndex.update((index) => index + 1)
  }

  /** One step back, never past the first. */
  back(): void {
    this.userHasActed = true
    this._stepIndex.update((index) => Math.max(0, index - 1))
  }

  /** Skip is final: it writes `done`, exactly as finishing does. Settings can replay it. */
  skip(): void {
    this.conclude()
  }

  private conclude(): void {
    this.userHasActed = true
    this.requested.set(false)
    this._stepIndex.set(0)
    this.stored.set(TourStoredState.DONE)
    this.write(TourStoredState.DONE)
  }

  private write(value: TourStoredState): void {
    this.writeChain = this.writeChain
      .then(() => this.storage.set(TOUR_STORAGE_KEY, value))
      // The storage never rejects by contract. Should that ever change, one
      // failed write must not wedge every write queued behind it for good.
      .catch((error: unknown) => console.warn('[OnboardingTourService] write failed', error))
  }

  /**
   * Pulls what the user's other devices know, monotonically: `done` beats
   * anything, `pending` is adopted only over nothing. A stale `pending` from a
   * device that never synced its `done` must not reopen a finished tour.
   */
  private async reconcileWithCloud(): Promise<void> {
    const cloud = this.toStoredState(await this.storage.get(TOUR_STORAGE_KEY))
    if (cloud === null) return
    // After the await, not before: the user may have acted while it was in flight.
    if (this.userHasActed) return

    if (cloud === TourStoredState.DONE) this.stored.set(TourStoredState.DONE)
    else if (this.stored() === null) this.stored.set(TourStoredState.PENDING)
  }

  /** `null` for anything that is not one of the two strings we write. */
  private toStoredState(value: string | null): TourStoredState | null {
    if (value === TourStoredState.PENDING) return TourStoredState.PENDING
    if (value === TourStoredState.DONE) return TourStoredState.DONE

    return null
  }
}
