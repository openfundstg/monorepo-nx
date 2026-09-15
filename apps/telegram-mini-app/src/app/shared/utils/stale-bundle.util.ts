/**
 * Recognising the one navigation failure a reload actually fixes.
 *
 * Every feature route is lazy, so Angular fetches it as its own bundle at the
 * moment of the first tap, and `outputHashing` names that bundle after a hash
 * of its contents. A release therefore renames all of them and deletes the old
 * names — and a phone that had the app open still holds the previous deploy's
 * `index.html`, which knows only the names that are now gone. The tap resolves
 * to a bundle the server no longer has.
 *
 * What the user sees is nothing at all: the import rejects, the router raises
 * `NavigationError`, and with no handler the screen simply stays put.
 *
 * Angular's builder emits native `import()`, so there is no error class to
 * check for — the rejection is a plain `TypeError` and every engine words its
 * message differently. Matching text is unpleasant, but the alternative is to
 * treat every navigation failure as stale and reload on genuine bugs too.
 */
const STALE_BUNDLE_MESSAGES = [
  /** Chromium, and so Telegram's Android WebView. */
  'failed to fetch dynamically imported module',
  /** Firefox. */
  'error loading dynamically imported module',
  /** Safari, and so Telegram's iOS WebView. */
  'importing a module script failed',
  /**
   * Any engine, when the server answered a missing bundle with `index.html`
   * instead of a 404 — what this app's Caddyfile did until the SPA fallback was
   * narrowed. It stays matched because that answer was served with a year-long
   * `immutable` header: phones that cached it are still failing this way, and
   * will keep failing until something reloads them.
   */
  'expected a javascript module script',
] as const;

/** The message an engine attached to the rejection, if it gave one at all. */
const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
};

/** Whether this navigation failed because its bundle belongs to an older deploy. */
export const isStaleBundleError = (error: unknown): boolean => {
  /**
   * Webpack's own class, thrown rather than described. The Angular builder does
   * not produce it, but `nx serve` and any future builder change might, and the
   * check costs one comparison.
   */
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;

  const message = messageOf(error).toLowerCase();

  return STALE_BUNDLE_MESSAGES.some((known) => message.includes(known));
};
