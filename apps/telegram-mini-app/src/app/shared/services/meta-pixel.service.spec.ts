import { TestBed } from '@angular/core/testing';
import { DOCUMENT, provideZonelessChangeDetection } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { MetaPixelService } from './meta-pixel.service';
import { environment } from '../../../environments/environment';
import { PixelStandardEvent, PixelTapEvent } from '../enums/pixel-event.enum';

const navigationTo = (url: string) => new NavigationEnd(1, url, url);

const ORIGINAL_PIXEL_ID = environment.metaPixelId;

describe('MetaPixelService', () => {
  let events: Subject<NavigationEnd>;
  let fbq: ReturnType<typeof vi.fn>;
  let appendChild: ReturnType<typeof vi.fn>;
  let created: { textContent: string };

  const build = (defaultView: unknown = undefined) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { events } },
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: defaultView === undefined ? { fbq } : defaultView,
            createElement: () => created,
            head: { appendChild },
          },
        },
      ],
    });

    return TestBed.inject(MetaPixelService);
  };

  beforeEach(() => {
    events = new Subject<NavigationEnd>();
    fbq = vi.fn();
    appendChild = vi.fn();
    created = { textContent: '' };
    // The id is the whole switch — see below.
    (environment as { metaPixelId: string }).metaPixelId = 'test-pixel-id';
  });

  afterEach(() => {
    (environment as { metaPixelId: string }).metaPixelId = ORIGINAL_PIXEL_ID;
  });

  /**
   * The tag used to sit in `index.html`, so every local run reported page views
   * into the same figures the ad campaigns are measured on. One configured
   * value now decides whether Facebook is contacted at all — which is a
   * stronger guarantee than a check inside a pixel that has already loaded.
   */
  describe('outside production', () => {
    beforeEach(() => {
      (environment as { metaPixelId: string }).metaPixelId = '';
    });

    it('never loads the pixel', () => {
      build();

      expect(appendChild).not.toHaveBeenCalled();
    });

    it('reports nothing, however much the app is navigated', () => {
      build();
      events.next(navigationTo('/deposit'));
      events.next(navigationTo('/referral'));

      expect(fbq).not.toHaveBeenCalled();
    });

    it('still answers a tracked tap without complaint', () => {
      const service = build();

      expect(() => service.trackAction(PixelTapEvent.START_SALE)).not.toThrow();
      expect(fbq).not.toHaveBeenCalled();
    });
  });

  describe('loading the pixel', () => {
    it('appends the loader to the document head', () => {
      build();

      expect(appendChild).toHaveBeenCalledTimes(1);
    });

    it('initialises it with the configured id', () => {
      build();

      expect(created.textContent).toContain("fbq('init', 'test-pixel-id')");
    });

    /** Meta's own snippet, so the stub that buffers early calls is theirs. */
    it('keeps Meta’s loader intact', () => {
      build();

      expect(created.textContent).toContain('connect.facebook.net/en_US/fbevents.js');
      expect(created.textContent).not.toContain('%PIXEL_ID%');
    });
  });

  describe('page views', () => {
    /**
     * The markup no longer reports the load, so the first navigation is the one
     * that counts it. Nothing is skipped any more, which is what removed the
     * seeded-URL comparison this service used to need.
     */
    it('reports the screen the app opened on', () => {
      build();
      events.next(navigationTo('/sale/AAAA1111'));

      expect(fbq).toHaveBeenCalledWith('track', 'PageView', undefined);
      expect(fbq).toHaveBeenCalledTimes(1);
    });

    it('reports each new screen', () => {
      build();
      for (const url of ['/', '/deposit', '/referral', '/settings']) {
        events.next(navigationTo(url));
      }

      expect(fbq).toHaveBeenCalledTimes(4);
    });

    /** Tapping the tab you are already on is not a new page view. */
    it('does not report the same screen twice in a row', () => {
      build();
      events.next(navigationTo('/deposit'));
      events.next(navigationTo('/deposit'));

      expect(fbq).toHaveBeenCalledTimes(1);
    });

    it('reports a return to a screen visited earlier', () => {
      build();
      for (const url of ['/deposit', '/referral', '/deposit']) {
        events.next(navigationTo(url));
      }

      expect(fbq).toHaveBeenCalledTimes(3);
    });

    /** A query string changes the page as far as the pixel is concerned. */
    it('treats a changed query string as a new page', () => {
      build();
      events.next(navigationTo('/deposit?amount=10'));
      events.next(navigationTo('/deposit?amount=20'));

      expect(fbq).toHaveBeenCalledTimes(2);
    });

    /**
     * Every navigation, not the latest one per change-detection pass. A signal
     * holds only its current value, and an analytics feed that quietly loses
     * events is worse than none — nothing about it looks wrong.
     */
    it('loses nothing when navigations arrive in the same tick', () => {
      build();
      events.next(navigationTo('/deposit'));
      events.next(navigationTo('/referral'));
      events.next(navigationTo('/settings'));

      expect(fbq).toHaveBeenCalledTimes(3);
    });
  });

  describe('tracked taps', () => {
    /**
     * `trackCustom`, never `track`. Meta's standard names carry meanings its
     * optimiser acts on, and calling an ordinary button press `Purchase` or
     * `Lead` teaches the ad platform something untrue.
     */
    it('reports a tap as a custom event', () => {
      build().trackAction(PixelTapEvent.START_SALE);

      expect(fbq).toHaveBeenCalledWith(
        'trackCustom',
        PixelTapEvent.START_SALE,
        undefined,
      );
    });

    it('carries the parameters it was given', () => {
      build().trackAction(PixelTapEvent.SELECT_BANK, { bank: 'PRIVAT' });

      expect(fbq).toHaveBeenCalledWith('trackCustom', PixelTapEvent.SELECT_BANK, {
        bank: 'PRIVAT',
      });
    });
  });

  /**
   * Meta's own names, reported through `track`. Ad delivery is optimised toward
   * whatever the pixel calls a conversion, so both the name and the number
   * attached to it spend real money.
   */
  describe('conversions', () => {
    it('reports a standard event by its Meta name', () => {
      build().trackConversion(PixelStandardEvent.COMPLETE_REGISTRATION);

      expect(fbq).toHaveBeenCalledWith('track', 'CompleteRegistration', undefined);
    });

    /**
     * The app counts money in kopecks and Meta's `value` wants major units.
     * Converting at the one call site rather than at each caller is what stops
     * an order worth ₴4 040 being reported as 404 000.
     */
    it('converts kopecks into hryvnia', () => {
      build().trackConversion(PixelStandardEvent.PURCHASE, 404_000);

      expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 4040, currency: 'UAH' });
    });

    it('keeps the fractional part of an odd amount', () => {
      build().trackConversion(PixelStandardEvent.INITIATE_CHECKOUT, 12_345);

      expect(fbq).toHaveBeenCalledWith('track', 'InitiateCheckout', {
        value: 123.45,
        currency: 'UAH',
      });
    });

    /** A step with no amount attached reports none, rather than a zero. */
    it('sends no value when none was given', () => {
      build().trackConversion(PixelStandardEvent.COMPLETE_REGISTRATION);

      expect(fbq.mock.calls[0][2]).toBeUndefined();
    });

    it('reports a zero amount as a zero, not as nothing', () => {
      build().trackConversion(PixelStandardEvent.PURCHASE, 0);

      expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 0, currency: 'UAH' });
    });

    it('is silent outside production, like everything else', () => {
      (environment as { metaPixelId: string }).metaPixelId = '';

      build().trackConversion(PixelStandardEvent.PURCHASE, 404_000);

      expect(fbq).not.toHaveBeenCalled();
    });
  });

  /**
   * A demo account is a promoter recording the app. Every take would otherwise
   * be a registration, a checkout and a purchase in the ad account that
   * measures the very campaign being recorded.
   */
  describe('once suspended', () => {
    it('reports nothing more — no views, no taps, no conversions', () => {
      const service = build();
      service.suspend();
      fbq.mockClear();

      events.next(navigationTo('/sale'));
      service.trackAction(PixelTapEvent.START_SALE);
      service.trackConversion(PixelStandardEvent.INITIATE_CHECKOUT, 468_000);

      expect(fbq).not.toHaveBeenCalled();
    });

    /**
     * Meta's script reports button taps by itself once initialised, which it
     * is at startup — the flag alone would silence only what goes through here.
     */
    it('revokes consent, so the pixel stops reporting on its own too', () => {
      build().suspend();

      expect(fbq).toHaveBeenCalledWith('consent', 'revoke', undefined);
    });
  });

  describe('when the pixel never answers', () => {
    /**
     * An ad blocker, a WebView with no network. Analytics must never be the
     * reason a tap or a navigation throws.
     */
    it('navigates and tracks without complaint', () => {
      const service = build({});

      expect(() => {
        events.next(navigationTo('/deposit'));
        service.trackAction(PixelTapEvent.START_SALE);
      }).not.toThrow();
    });

    it('survives having no window at all', () => {
      const service = build(null);

      expect(() => {
        events.next(navigationTo('/deposit'));
        service.trackAction(PixelTapEvent.START_SALE);
      }).not.toThrow();
    });
  });
});
