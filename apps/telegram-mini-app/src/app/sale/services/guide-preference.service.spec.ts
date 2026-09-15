import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { GuidePreferenceService } from './guide-preference.service';
import { TmaStorageService } from '../../shared/services/tma-storage.service';
import { GUIDE_EXPANDED_STORAGE_KEY } from '../constants/bank-guide.const';

/**
 * A stand-in for the real storage, with the two reads kept separate so the
 * timing that matters can be asserted: `getLocal` is synchronous and answers
 * during construction, `get` is the awaited cloud round trip.
 */
class StorageStub {
  local: string | null = null;
  cloud: string | null = null;
  readonly writes: Array<{ key: string; value: string }> = [];

  getLocal(key: string): string | null {
    return key === GUIDE_EXPANDED_STORAGE_KEY ? this.local : null;
  }

  async get(key: string): Promise<string | null> {
    return key === GUIDE_EXPANDED_STORAGE_KEY ? (this.cloud ?? this.local) : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.writes.push({ key, value });
    this.local = value;
  }
}

const build = (setup: (storage: StorageStub) => void = () => undefined) => {
  const storage = new StorageStub();
  setup(storage);

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      GuidePreferenceService,
      { provide: TmaStorageService, useValue: storage },
    ],
  });

  return { storage, service: TestBed.inject(GuidePreferenceService) };
};

describe('GuidePreferenceService', () => {
  it('opens the guide for someone who has never chosen', () => {
    const { service } = build();

    expect(service.expanded()).toBe(true);
  });

  /**
   * The point of the feature: an experienced user collapses it once and it
   * stays collapsed, instead of having to do it on every order.
   */
  it('honours a stored collapse', () => {
    const { service } = build((storage) => {
      storage.local = 'collapsed';
    });

    expect(service.expanded()).toBe(false);
  });

  /**
   * Read synchronously, before the first render. Awaiting CloudStorage here
   * would paint the guide open and snap it shut up to 1.5s later — on the
   * screen the user is reading.
   */
  it('applies the stored value without waiting for anything', () => {
    const { service } = build((storage) => {
      storage.local = 'collapsed';
    });

    // No `await` anywhere above: the value is already correct.
    expect(service.expanded()).toBe(false);
  });

  it('persists a collapse under a CloudStorage-legal key', async () => {
    const { service, storage } = build();

    await service.toggle();

    expect(service.expanded()).toBe(false);
    expect(storage.writes).toEqual([
      { key: GUIDE_EXPANDED_STORAGE_KEY, value: 'collapsed' },
    ]);
    expect(GUIDE_EXPANDED_STORAGE_KEY).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it('persists an expand too, so the choice is reversible', async () => {
    const { service, storage } = build((storage) => {
      storage.local = 'collapsed';
    });

    await service.toggle();

    expect(service.expanded()).toBe(true);
    expect(storage.writes.at(-1)?.value).toBe('expanded');
  });

  /** A choice made on another device arrives late and still takes effect. */
  it('adopts a collapse stored in the cloud', async () => {
    const { service } = build((storage) => {
      storage.cloud = 'collapsed';
    });

    expect(service.expanded()).toBe(true); // nothing local yet
    await Promise.resolve();
    await Promise.resolve();

    expect(service.expanded()).toBe(false);
  });

  /**
   * Absent means "never chosen", not "collapsed" — the default has to survive
   * a storage backend that simply has nothing.
   */
  it('keeps the default when storage holds nothing', async () => {
    const { service } = build();

    await Promise.resolve();
    await Promise.resolve();

    expect(service.expanded()).toBe(true);
  });

  /** A stray value must not read as truthy and silently collapse the guide. */
  it('ignores a value it did not write', async () => {
    const { service } = build((storage) => {
      storage.local = 'true';
    });

    expect(service.expanded()).toBe(true);
  });

  /**
   * The race the implementation guards against. The cloud read is in flight for
   * up to 1.5s after the page opens — long enough for the user to tap the
   * toggle first — and a reconcile landing afterwards would silently undo it.
   */
  it('does not let a late cloud read undo a tap the user just made', async () => {
    // Stored as collapsed everywhere, so the reconcile carries a value that
    // conflicts with the tap below.
    const { service } = build((storage) => {
      storage.local = 'collapsed';
      storage.cloud = 'collapsed';
    });

    await service.toggle(); // the user opens the guide while the read is pending
    await Promise.resolve();
    await Promise.resolve();

    expect(service.expanded()).toBe(true);
  });
});
