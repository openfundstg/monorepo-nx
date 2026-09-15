import { isStaleBundleError } from './stale-bundle.util';

/**
 * The rejections a failed `import()` actually produces, worded as each engine
 * words them. Every one of these is a user whose navigation stopped working
 * after a deploy, so a message this predicate fails to recognise is a user left
 * on a dead screen.
 */
describe('isStaleBundleError', () => {
  it.each([
    ['Chromium', 'Failed to fetch dynamically imported module: https://openfunds.top/chunk-A1.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    [
      'the SPA fallback answering with HTML',
      'Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ],
  ])('recognises %s', (_engine, message) => {
    expect(isStaleBundleError(new TypeError(message))).toBe(true);
  });

  it('recognises a webpack ChunkLoadError by its name alone', () => {
    const error = new Error('Loading chunk 42 failed.');
    error.name = 'ChunkLoadError';

    expect(isStaleBundleError(error)).toBe(true);
  });

  it('matches whatever case the engine used', () => {
    expect(isStaleBundleError(new TypeError('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(
      true,
    );
  });

  it('reads a message thrown as a bare string', () => {
    expect(isStaleBundleError('Failed to fetch dynamically imported module')).toBe(true);
  });

  /**
   * The expensive direction. Every match here reloads the app, so a guard that
   * fails a resolver, a rejected guard or a plain bug in a route's constructor
   * must not look like a stale bundle — reloading would hide the bug behind a
   * refresh and drop whatever the user had typed.
   */
  it.each([
    ['a failed resolver', new Error('Cannot read properties of undefined')],
    ['an HTTP failure', new Error('Http failure response for /api/user: 500 Internal Server Error')],
    ['a rejected guard', new Error('NG04002: Cannot match any routes')],
    ['a component that threw', new TypeError('this.user is not a function')],
  ])('leaves %s alone', (_case, error) => {
    expect(isStaleBundleError(error)).toBe(false);
  });

  it.each([[undefined], [null], [{}], [42]])('survives %p as the error', (error) => {
    expect(isStaleBundleError(error)).toBe(false);
  });
});
