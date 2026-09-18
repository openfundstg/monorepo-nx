import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** How often the clock advances. A countdown is read in seconds. */
const TICK_MS = 1000;

/**
 * The current time, as a signal that moves.
 *
 * A deadline is a fixed instant; what changes is *now*, and the templates that
 * show "4:38 left" are re-rendering because of that and nothing else. So the
 * moving part is held once, app-wide, and every countdown is an ordinary
 * `computed` over it — no timer per screen, no timer per row, and nothing to
 * forget to clear.
 *
 * Two screens had already written their own `startCountdown`, each holding an
 * interval id and clearing it in `ngOnDestroy`. That works for one deadline on
 * one page. It does not extend to a list: a card sale shows a countdown per
 * payment, and the per-component pattern would have meant an interval per row,
 * created and torn down as the list changed.
 *
 * `providedIn: 'root'`, so there is exactly one interval in the application.
 * At 1 Hz it costs nothing measurable, and having it always running is what
 * makes reading it free of setup — a component injects the signal and is done.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly tick = signal(Date.now());

  /** Epoch milliseconds, republished every second. */
  readonly now = this.tick.asReadonly();

  constructor() {
    const id = setInterval(() => this.tick.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
