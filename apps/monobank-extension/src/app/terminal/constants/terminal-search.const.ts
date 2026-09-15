/**
 * Client-side bounds on the terminal search.
 *
 * `MIN_TERM_LENGTH` mirrors the server's `TerminalSearch.MIN_TERM_LENGTH`. It is
 * duplicated rather than shared because it is a UI rule here — below it the
 * client simply does not ask — and a validation rule there; the server is still
 * the one that enforces it.
 */
export const TerminalSearchBounds = {
  MIN_TERM_LENGTH: 2,
  /** Long enough to cover typing a jar name, short enough to feel immediate. */
  DEBOUNCE_MS: 300,
} as const;
