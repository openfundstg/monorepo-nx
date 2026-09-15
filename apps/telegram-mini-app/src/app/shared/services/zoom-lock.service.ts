import { DOCUMENT, Injectable, inject } from '@angular/core';

/**
 * WebKit's own pinch events. Non-standard, and the only notice Safari and every
 * iOS WebView give that a two-finger zoom is starting.
 */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * Holds the page at 1× by refusing the browser's zoom gestures.
 *
 * Users reported the app zooming itself while they flicked through the task
 * switcher: the WebView picks up stray multi-touch during the transition, reads
 * it as a pinch, and the new scale sticks because nothing ever puts it back.
 *
 * This is the third of three layers, and all three are needed:
 *
 * - the viewport meta pins the scale, but **WebKit has ignored `user-scalable=no`
 *   since iOS 10**, which is most of Telegram's mobile audience;
 * - `touch-action: pan-x pan-y` withdraws pinch while keeping scrolling, but is
 *   not honoured for pinch by every WebView version still in circulation;
 * - these listeners cover WebKit specifically, which is where the meta fails.
 *
 * A deliberate accessibility trade-off: pinch-to-zoom is a real accommodation,
 * and this removes it. It is the usual bargain for a Mini App — the layout is
 * built for one hand at one scale, and text follows Telegram's own size — but
 * it is a bargain, not a free win.
 */
@Injectable({ providedIn: 'root' })
export class ZoomLockService {
  private readonly document = inject(DOCUMENT);

  private locked = false;

  private readonly refuse = (event: Event): void => event.preventDefault();

  /**
   * Registers the listeners. Idempotent, so a second call cannot double-bind.
   *
   * `passive: false` is the whole point: a passive listener may not call
   * `preventDefault`, and the browser assumes passive for touch-adjacent events
   * unless told otherwise — so the default would leave this doing nothing at all.
   */
  lock(): void {
    if (this.locked) return;
    this.locked = true;

    for (const event of GESTURE_EVENTS) {
      this.document.addEventListener(event, this.refuse, { passive: false });
    }
  }
}
