import { TestBed } from '@angular/core/testing';
import { DOCUMENT, provideZonelessChangeDetection } from '@angular/core';
import { StaleBundleRecoveryService } from './stale-bundle-recovery.service';

const STALE = new TypeError('Failed to fetch dynamically imported module: /chunk-A1.js');

describe('StaleBundleRecoveryService', () => {
  let assign: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  let store: Map<string, string>;
  let sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;

  /** A `defaultView` with only the two surfaces the service touches. */
  const build = (defaultView: unknown = { location: { assign, reload }, sessionStorage }) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DOCUMENT, useValue: { defaultView } },
      ],
    });

    return TestBed.inject(StaleBundleRecoveryService);
  };

  beforeEach(() => {
    assign = vi.fn();
    reload = vi.fn();
    store = new Map();
    sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  });

  it('loads the route the user was trying to reach', () => {
    expect(build().recover(STALE, '/sale/create')).toBe(true);
    expect(assign).toHaveBeenCalledWith('/sale/create');
    expect(reload).not.toHaveBeenCalled();
  });

  it('falls back to reloading when the router named no url', () => {
    expect(build().recover(STALE)).toBe(true);
    expect(reload).toHaveBeenCalled();
  });

  /**
   * The one that matters most. A WebView reloading in a loop is worse than a
   * dead screen — the user cannot read an error, cannot navigate away, and in
   * Telegram cannot easily close it either.
   */
  it('reloads at most once per session', () => {
    const service = build();

    expect(service.recover(STALE, '/deposit')).toBe(true);
    expect(service.recover(STALE, '/deposit')).toBe(false);
    expect(service.recover(STALE, '/settings')).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  /** The marker outlives the instance, since a reload builds a new one. */
  it('does not reload again after the reload it caused', () => {
    expect(build().recover(STALE, '/deposit')).toBe(true);
    expect(build().recover(STALE, '/deposit')).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  /**
   * With nowhere to record the attempt there is nothing to stop the next
   * failure reloading again, so the guard has to fail closed.
   */
  it.each([
    ['reads throw', { getItem: () => { throw new Error('denied'); }, setItem: vi.fn() }],
    ['writes throw', { getItem: () => null, setItem: () => { throw new Error('quota'); } }],
  ])('declines to reload when storage %s', (_case, unusable) => {
    sessionStorage = unusable as Pick<Storage, 'getItem' | 'setItem'>;

    expect(build().recover(STALE, '/deposit')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves an ordinary navigation failure alone', () => {
    expect(build().recover(new Error('NG04002: Cannot match any routes'), '/deposit')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * `location.assign` follows a protocol-relative url off-site, and a deep link
   * reaches the router as attacker-controlled input.
   */
  it.each(['//evil.example', 'https://evil.example', 'javascript:alert(1)'])(
    'refuses to send the user to %p, reloading instead',
    (url) => {
      expect(build().recover(STALE, url)).toBe(true);
      expect(assign).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    },
  );

  it('does nothing without a window to reload', () => {
    expect(build(null).recover(STALE, '/deposit')).toBe(false);
  });
});
