import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LoadingService } from './loading.service';
import { SPINNER_DELAY_MS } from '../constants/loading.const';

describe('LoadingService', () => {
  let service: LoadingService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), LoadingService],
    });
    service = TestBed.inject(LoadingService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing at rest', () => {
    expect(service.visible()).toBe(false);
  });

  /**
   * The reason the delay exists. Nearly every call here beats it, and an
   * overlay that flashes up for a request that was never slow reads as jank.
   */
  it('stays hidden for a request that finishes inside the delay', () => {
    service.start();

    // Asserted while the request is still running, not only once it has
    // finished: checking the end state alone would pass even if the overlay had
    // flashed up and back down, which is the exact thing the delay prevents.
    expect(service.visible()).toBe(false);
    vi.advanceTimersByTime(SPINNER_DELAY_MS - 1);
    expect(service.visible()).toBe(false);

    service.stop();
    expect(service.visible()).toBe(false);

    // And never appears afterwards — the timer is disarmed, not merely ignored.
    vi.advanceTimersByTime(SPINNER_DELAY_MS * 10);
    expect(service.visible()).toBe(false);
  });

  it('appears once a request outlives the delay', () => {
    service.start();

    expect(service.visible()).toBe(false);
    vi.advanceTimersByTime(SPINNER_DELAY_MS);
    expect(service.visible()).toBe(true);
  });

  it('goes away when that request finishes', () => {
    service.start();
    vi.advanceTimersByTime(SPINNER_DELAY_MS);
    service.stop();

    expect(service.visible()).toBe(false);
  });

  describe('with several requests in flight', () => {
    /**
     * The overlay belongs to the burst, not to any one request — otherwise the
     * first call to finish would uncover a screen that is still loading.
     */
    it('stays up until the last one finishes', () => {
      service.start();
      service.start();
      vi.advanceTimersByTime(SPINNER_DELAY_MS);
      expect(service.visible()).toBe(true);

      service.stop();
      expect(service.visible()).toBe(true);

      service.stop();
      expect(service.visible()).toBe(false);
    });

    /**
     * A later request must not restart the clock: a steady trickle of calls
     * would keep pushing the overlay back and it would never appear at all.
     */
    it('measures the delay from the first request, not the latest', () => {
      service.start();
      vi.advanceTimersByTime(SPINNER_DELAY_MS - 50);

      service.start();
      vi.advanceTimersByTime(50);

      expect(service.visible()).toBe(true);
    });

    it('arms the timer again for a burst that follows a quiet spell', () => {
      service.start();
      vi.advanceTimersByTime(SPINNER_DELAY_MS);
      service.stop();
      expect(service.visible()).toBe(false);

      service.start();
      vi.advanceTimersByTime(SPINNER_DELAY_MS);

      expect(service.visible()).toBe(true);
    });
  });

  /**
   * `finalize` should keep these balanced, but an unmatched `stop` must not
   * drive the count negative — the overlay would then stick until as many
   * extra starts arrived to climb back to zero.
   */
  it('survives a stop with no matching start', () => {
    service.stop();
    service.stop();

    service.start();
    vi.advanceTimersByTime(SPINNER_DELAY_MS);
    expect(service.visible()).toBe(true);

    service.stop();
    expect(service.visible()).toBe(false);
  });
});
