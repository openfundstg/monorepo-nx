import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppVersionService } from './app-version.service';

const indexHtml = (bundle: string) =>
  `<!doctype html><html><head><script src="https://telegram.org/js/telegram-web-app.js"></script>` +
  `</head><body><app-root></app-root><script src="${bundle}" type="module"></script></body></html>`;

const serving = (...bundles: readonly string[]) => {
  const responses = bundles.map((bundle) => ({ ok: true, text: async () => indexHtml(bundle) }));

  return vi
    .fn()
    .mockImplementation(async () => responses.shift() ?? responses[responses.length - 1]);
};

describe('AppVersionService', () => {
  let service: AppVersionService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(AppVersionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fetchServing = (...bundles: readonly string[]) => {
    const fetchMock = serving(...bundles);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    return fetchMock;
  };

  it('does not ask anyone to update the build they just loaded', async () => {
    fetchServing('main-AAA111.js', 'main-AAA111.js');

    await service.start();
    await service.check();

    expect(service.updateRequired()).toBe(false);
  });

  /** The hash changing is the release; nothing else has to be maintained. */
  it('demands an update once the entry bundle is a different one', async () => {
    fetchServing('main-AAA111.js', 'main-BBB222.js');

    await service.start();
    await service.check();

    expect(service.updateRequired()).toBe(true);
  });

  /**
   * There is no way back. The code that would decide the update no longer
   * applies is the old code — which is exactly what is out of date.
   */
  it('never takes the demand back', async () => {
    fetchServing('main-AAA111.js', 'main-BBB222.js', 'main-AAA111.js');

    await service.start();
    await service.check();
    await service.check();

    expect(service.updateRequired()).toBe(true);
  });

  /**
   * A lift, a train, a tunnel. Locking somebody out of a screen because their
   * connection blinked is a worse product than a minute of staleness.
   */
  it('changes nothing when the check cannot be made', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await service.start();
    await service.check();

    expect(service.updateRequired()).toBe(false);
  });

  /** In development nothing is hashed, so the same name comes back forever. */
  it('stays quiet against an unhashed dev bundle', async () => {
    fetchServing('main.js', 'main.js', 'main.js');

    await service.start();
    await service.check();
    await service.check();

    expect(service.updateRequired()).toBe(false);
  });
});
