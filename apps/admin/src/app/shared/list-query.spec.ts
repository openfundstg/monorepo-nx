import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** `src/app`, found from this file rather than from the working directory. */
const APP = dirname(dirname(fileURLToPath(import.meta.url)));

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

/**
 * Every page that renders a list, found by what its template draws.
 *
 * By the template rather than by a filename convention, because the convention
 * is what somebody adding the fourteenth list will not know about.
 */
const listPages = (): readonly { readonly path: string; readonly source: string }[] =>
  filesUnder(APP)
    .filter((path) => path.endsWith('.component.html'))
    .filter((path) => readFileSync(path, 'utf8').includes('<app-collection-table'))
    .map((path) => ({
      path: relative(APP, path),
      source: readFileSync(path.replace(/\.html$/, '.ts'), 'utf8'),
    }));

/**
 * The guard on cross-linking, which fails silently without it.
 *
 * **Every link this panel builds carries `search` or `filter` as a query
 * parameter**, and a list applies them through `bindListQuery`. A list that
 * opens itself with a bare `entered()` ignores the URL — so the link still
 * navigates, the screen still renders, and the only symptom is that the
 * destination shows *everything*. Nothing throws and no test fails.
 *
 * That is exactly what shipped: links were built to ten lists that never read
 * the URL, and `/admin/orders?search=30323` listed every order on every card.
 * There is no type that can express "this component read its query string", so
 * the check is on the source.
 */
describe('every list applies the URL it was opened with', () => {
  it('finds the list pages at all', () => {
    // If this ever reads zero, the two checks below pass by vacuum.
    expect(listPages().length).toBeGreaterThan(10);
  });

  it('opens through bindListQuery', () => {
    const missing = listPages()
      .filter((page) => !page.source.includes('bindListQuery('))
      .map((page) => page.path);

    expect(missing, `these ignore ?search= and ?filter=: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * `bindListQuery` sends `entered` itself, and only when the URL asked for
   * nothing. A page that also sends it by hand fetches the same page twice —
   * once immediately and once after the search debounce — and the stale answer
   * is the one that arrives second.
   */
  it('does not also enter by hand', () => {
    const doubled = listPages()
      .filter((page) => page.source.includes('.actions.entered()'))
      .map((page) => page.path);

    expect(doubled, `these load twice: ${doubled.join(', ')}`).toEqual([]);
  });
});
