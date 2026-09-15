import { Injectable, inject, signal } from '@angular/core';
import { TmaStorageService } from '../../shared/services/tma-storage.service';
import { GUIDE_EXPANDED_STORAGE_KEY } from '../constants/bank-guide.const';

/** What is written to storage. Explicit strings, so a stray value is not truthy. */
const StoredState = {
  EXPANDED: 'expanded',
  COLLAPSED: 'collapsed',
} as const;

/**
 * Remembers whether the bank guide is open, across sessions and devices.
 *
 * A first-time user needs the steps, so the guide starts open. Someone on their
 * twentieth sale does not, and having to collapse it every single time
 * is the kind of small friction that makes an app feel like it is not paying
 * attention. The choice is theirs once.
 *
 * Read synchronously from local storage for the first paint and reconciled
 * against CloudStorage afterwards. Doing it the other way round — awaiting the
 * cloud — would render the guide open and snap it shut a moment later, on the
 * very screen the user is reading.
 */
@Injectable({ providedIn: 'root' })
export class GuidePreferenceService {
  private readonly storage = inject(TmaStorageService);

  /**
   * Open unless the user has said otherwise.
   *
   * Seeded from the synchronous local read so a returning user never sees the
   * guide flash open before collapsing.
   */
  readonly expanded = signal(
    this.toExpanded(this.storage.getLocal(GUIDE_EXPANDED_STORAGE_KEY)) ?? true,
  );

  constructor() {
    // Only tells us anything new on a device where the choice was made
    // elsewhere; on this one the local value already matched, so nothing moves.
    void this.reconcileWithCloud();
  }

  /**
   * Set the moment the user touches the toggle.
   *
   * The cloud read is still in flight for up to {@link CLOUD_TIMEOUT_MS} after
   * the page opens, which is easily long enough to tap the guide first — and a
   * reconcile landing afterwards would undo that tap. A deliberate choice made
   * here and now always outranks a stored one arriving late.
   */
  private userHasChosen = false;

  /** Flips the guide and remembers the new state. */
  async toggle(): Promise<void> {
    this.userHasChosen = true;

    const next = !this.expanded();
    this.expanded.set(next);

    await this.storage.set(
      GUIDE_EXPANDED_STORAGE_KEY,
      next ? StoredState.EXPANDED : StoredState.COLLAPSED,
    );
  }

  /**
   * Pulls the choice made on the user's other devices.
   *
   * Deliberately does not overwrite anything when storage holds nothing: an
   * absent value means "never chosen", and the default is already applied.
   * Failures are swallowed by `TmaStorageService` itself, which answers `null`
   * rather than rejecting.
   */
  private async reconcileWithCloud(): Promise<void> {
    const stored = this.toExpanded(await this.storage.get(GUIDE_EXPANDED_STORAGE_KEY));
    if (stored === null) return;

    // Checked *after* the await, not before: the user may have tapped while it
    // was in flight, and this value is older than that tap.
    if (this.userHasChosen) return;

    this.expanded.set(stored);
  }

  /** `null` for anything that is not one of the two states we write. */
  private toExpanded(value: string | null): boolean | null {
    if (value === StoredState.EXPANDED) return true;
    if (value === StoredState.COLLAPSED) return false;

    return null;
  }
}
