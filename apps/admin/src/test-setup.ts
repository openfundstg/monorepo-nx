/**
 * jsdom has no `matchMedia`, and Angular Material's overlay and ripple code
 * calls it during construction — so a component test that merely renders a
 * `mat-menu` would throw before reaching its assertion.
 *
 * Stubbed as "no media query matches", which is the honest answer for a
 * headless environment with no viewport.
 */
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
