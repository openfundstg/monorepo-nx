/**
 * The launch screen `index.html` paints before the bundle has parsed.
 *
 * The element and its styles are written out in that file — it has to stand up
 * without the stylesheet, which the production build loads asynchronously — and
 * these two are the handle `AppComponent` takes it down by.
 */
export const SPLASH_ELEMENT_ID = 'splash'

/** Marks it fading; the class is defined next to the element, in `index.html`. */
export const SPLASH_LEAVING_CLASS = 'is-leaving'

/**
 * Must match the `transition` on `#splash`. Removing the node before the fade
 * has run leaves the cut this fade exists to soften; leaving it much longer
 * parks a transparent overlay over the first screen, swallowing its first tap.
 */
export const SPLASH_FADE_MS = 250
