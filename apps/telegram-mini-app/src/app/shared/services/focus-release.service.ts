import { DOCUMENT, Injectable, inject } from '@angular/core'

/**
 * What a press must never be answered by blurring, and it is two lists.
 *
 * **The fields themselves**, for the obvious reason — a `<label>` among them
 * although it holds no caret of its own, because tapping one is how you focus
 * the control it names and blurring on the way would take the keyboard down a
 * frame after the browser raised it.
 *
 * **And every other control**, which is less obvious and matters more. Blurring
 * dismisses the keyboard, iOS scrolls the page back as it goes, and the `click`
 * that was about to be delivered lands wherever the target has moved to. That
 * is the "this button needs two taps" bug, and it would have been introduced by
 * the very thing meant to make the screen easier to use — on "confirm this
 * amount", the one button people reach for with the keyboard still up.
 *
 * So a control keeps the focus and handles its own press; the keyboard goes
 * when its field is removed or when the next tap lands on nothing. What is left
 * is exactly what was asked for: empty space dismisses.
 */
const KEEPS_FOCUS =
  'input, textarea, select, label, [contenteditable], button, a, [role="button"]'

/**
 * Gives a tap on empty space back to the page, by taking focus off the field.
 *
 * **iOS has no other way out.** On Android the system Back key dismisses the
 * keyboard and leaves the app alone; in an iOS WebView there is no such key, no
 * *Done* bar above a `type="text"` field, and Telegram's own chrome is not the
 * page — so a seller who has opened "a different amount arrived" is left with
 * half the screen covered and nothing to tap that closes it. They scroll,
 * they hunt, and the field they were trying to read is the one under the
 * keyboard.
 *
 * So the page itself answers: a press that lands on nothing gives the caret
 * up.
 *
 * **`pointerdown`, not `click`.** A click arrives only once the finger is
 * lifted, which is 100–300 ms of keyboard still up, and never arrives at all
 * for a press that turns into a scroll — which is exactly the gesture somebody
 * makes when they are trying to see past the keyboard. Pointer events cover
 * touch, pen and mouse from one listener.
 *
 * **Capture, because a stopped bubble is not a reason to keep the keyboard.**
 * Several components here call `stopPropagation` to keep an outside-click
 * handler of their own from firing; on the bubble phase this would simply not
 * run for those taps, and the behaviour would be missing on the screens with
 * the most controls on them.
 *
 * It never calls `preventDefault`, so nothing it does can swallow a tap: the
 * button being pressed still gets its click, and the field being pressed still
 * gets its caret.
 */
@Injectable({ providedIn: 'root' })
export class FocusReleaseService {
  private readonly document = inject(DOCUMENT)

  private listening = false

  private readonly release = (event: Event): void => {
    const active = this.document.activeElement

    // Nothing holds the caret, or what holds it is the page itself. `<body>`
    // is what `activeElement` answers when nothing is focused.
    if (!(active instanceof HTMLElement) || active === this.document.body) return

    // The press landed on a control. `closest` rather than a tag check on the
    // target: a tap lands on the `<span>` inside a button or a label far more
    // often than on the element itself.
    const target = event.target
    if (target instanceof Element && target.closest(KEEPS_FOCUS) !== null) return

    active.blur()
  }

  /**
   * Registers the listener. Idempotent, in the manner of `ZoomLockService.lock`,
   * so a second call cannot double-bind.
   *
   * `passive: true` states what is already true — this never prevents a default
   * — and lets the browser keep scrolling without waiting to hear from us,
   * which on a press that becomes a scroll is the difference nobody should pay.
   */
  start(): void {
    if (this.listening) return
    this.listening = true

    this.document.addEventListener('pointerdown', this.release, { capture: true, passive: true })
  }
}
