import { TestBed } from '@angular/core/testing';
import { DOCUMENT, provideZonelessChangeDetection } from '@angular/core';
import { ZoomLockService } from './zoom-lock.service';

/** WebKit's pinch events — the only notice iOS gives that a zoom is starting. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];

describe('ZoomLockService', () => {
  let addEventListener: ReturnType<typeof vi.fn>;
  let service: ZoomLockService;

  const build = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DOCUMENT, useValue: { addEventListener } },
      ],
    });

    return TestBed.inject(ZoomLockService);
  };

  beforeEach(() => {
    addEventListener = vi.fn();
    service = build();
  });

  it('refuses every WebKit pinch gesture', () => {
    service.lock();

    for (const event of GESTURE_EVENTS) {
      expect(addEventListener).toHaveBeenCalledWith(event, expect.any(Function), expect.anything());
    }
  });

  /**
   * The browser assumes passive for touch-adjacent events unless told
   * otherwise, and a passive listener may not call `preventDefault` — so
   * without this the whole thing would bind and then do nothing.
   */
  it('binds non-passively, or preventDefault would be ignored', () => {
    service.lock();

    for (const [, , options] of addEventListener.mock.calls) {
      expect(options).toEqual({ passive: false });
    }
  });

  it('actually prevents the gesture', () => {
    service.lock();

    const [, handler] = addEventListener.mock.calls[0];
    const preventDefault = vi.fn();
    handler({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalled();
  });

  /** The shell calls it on init; a second call must not double-bind. */
  it('is idempotent', () => {
    service.lock();
    service.lock();
    service.lock();

    expect(addEventListener).toHaveBeenCalledTimes(GESTURE_EVENTS.length);
  });
});
