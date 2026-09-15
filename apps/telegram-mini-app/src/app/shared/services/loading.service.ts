import { Injectable, signal } from '@angular/core';
import { SPINNER_DELAY_MS } from '../constants/loading.const';

/**
 * Whether the app is waiting on the network, as the screen should show it.
 *
 * Counts requests rather than tracking a boolean, because several can be in
 * flight at once: the overlay goes up when the first one starts and comes down
 * only when the last one finishes, so two overlapping calls do not hide it
 * halfway through.
 *
 * The delay is the whole design. Nearly every call here returns faster than
 * {@link SPINNER_DELAY_MS}, and showing an overlay for those would make a fast
 * app look busy — so the timer is armed on the first request and disarmed
 * untouched if everything finishes in time. Nothing is ever painted.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  /**
   * Requests currently running.
   *
   * A plain number on purpose: nothing renders it, and making it a signal would
   * invite a template to depend on the count rather than on {@link visible},
   * which is the only thing that respects the delay.
   */
  private inFlight = 0;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly _visible = signal(false);

  /** True only once a request has been running longer than the delay. */
  readonly visible = this._visible.asReadonly();

  start(): void {
    this.inFlight += 1;
    if (this.inFlight > 1) return;

    // First request of a burst arms the timer. Later ones join the same wait
    // rather than restarting it — otherwise a steady trickle of calls would
    // keep pushing the overlay back and it would never appear at all.
    this.timer = setTimeout(() => this._visible.set(true), SPINNER_DELAY_MS);
  }

  stop(): void {
    // Clamped: a `stop` without a matching `start` must not drive the count
    // negative, or the overlay would stick until as many extra starts arrived.
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight > 0) return;

    clearTimeout(this.timer);
    this.timer = undefined;
    this._visible.set(false);
  }
}
