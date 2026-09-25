import { DOCUMENT, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { KOPECKS_PER_UAH } from '@transacto/contracts';
import { environment } from '../../../environments/environment';
import { PIXEL_CURRENCY } from '../enums/pixel-event.enum';
import type { PixelStandardEvent, PixelTapEvent } from '../enums/pixel-event.enum';

/**
 * The pixel's queue stub, as Meta's own snippet defines it.
 *
 * The snippet creates `fbq` synchronously — it sets `fbq.queue = []` before the
 * remote script is even requested — so calls made before the script has landed
 * are buffered rather than lost, and there is no race to guard against. Typed
 * here rather than on the global `Window`: this is the only file that talks to
 * it.
 */
type Fbq = (command: string, event: string, parameters?: Record<string, unknown>) => void;

/**
 * Meta's loader, verbatim.
 *
 * Kept as their text rather than rewritten in TypeScript on purpose: it is the
 * integration contract, it defines the buffering stub the type above describes,
 * and a hand-rolled version would be ours to keep in step with theirs for no
 * gain. Only `%PIXEL_ID%` is substituted, and only the decision to run it at all
 * is ours.
 */
const LOADER = `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '%PIXEL_ID%');
`;

@Injectable({ providedIn: 'root' })
export class MetaPixelService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);

  /**
   * The path the last `PageView` was reported for, or `null` when none has been.
   *
   * The comparison it feeds suppresses a re-navigation to the screen the user
   * is already on — tapping the current tab in the bottom nav — which is not a
   * new page view by any reading.
   */
  private lastReported: string | null = null;

  /**
   * Set for a demo account, and never cleared.
   *
   * A promoter recording the app is not a customer, and every take would
   * otherwise report a registration, a checkout and a purchase — with sums —
   * into the ad account that measures the campaign they are recording for.
   * Meta's delivery optimises toward whatever the pixel calls a conversion, so
   * those would spend real money looking for more people like the promoter.
   */
  private suspended = false;

  /**
   * Whether this service may talk to a pixel at all.
   *
   * Stated rather than inferred from `window.fbq` being absent. Something else
   * on the page could define `fbq` — a second tag, a tag manager — and a pixel
   * we deliberately did not load must not start reporting through somebody
   * else's.
   */
  private readonly enabled = Boolean(environment.metaPixelId);

  /**
   * Loads the pixel and follows the router, or does neither.
   *
   * The tag used to live in `index.html`, which meant every local run reported
   * into the same figures the ad campaigns are measured on. It is loaded from
   * here instead so that one value — `environment.metaPixelId` — decides
   * whether Facebook is contacted at all, rather than a check buried inside a
   * pixel that has already loaded.
   *
   * The `PageView` for the load is reported here too, not by the markup. That
   * is a beat later than a tag in the head would fire, and it will not fire at
   * all if the app fails to bootstrap — which is the honest answer, since
   * nobody saw a page.
   */
  constructor() {
    if (!this.enabled) return;

    this.load(environment.metaPixelId);

    // Every `NavigationEnd`, not the latest one settled per change-detection
    // pass. A signal holds only its current value, so two navigations landing
    // in one pass would collapse into a single reported view — and an analytics
    // feed that quietly loses events is worse than none, because nothing about
    // it looks wrong.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.reportPageView(event.urlAfterRedirects));
  }

  /**
   * Reports a custom event — a tap on something worth counting.
   *
   * `trackCustom` rather than `track`: Meta's standard event names carry
   * meanings its optimiser acts on, and labelling an ordinary button press as
   * `Purchase` or `Lead` teaches the ad platform something untrue. A name of
   * our own says exactly what happened and nothing more.
   *
   * Safe to call whether or not the pixel was ever loaded.
   */
  trackAction(action: PixelTapEvent, parameters?: Record<string, unknown>): void {
    this.send('trackCustom', action, parameters);
  }

  /**
   * Reports one of Meta's own events — a step in the funnel, not a tap.
   *
   * `valueKopecks` is money in UAH kopecks, as everything in this app counts it,
   * and is converted here to the major units Meta's `value` expects. Doing it
   * in one place is the point: a call site that passed kopecks straight through
   * would report a hundredfold value, and ad delivery is optimised on exactly
   * that number.
   *
   * Passing no value reports the event without one, which is right for a step
   * that has no amount attached.
   */
  trackConversion(event: PixelStandardEvent, valueKopecks?: number): void {
    const parameters =
      valueKopecks === undefined
        ? undefined
        : { value: valueKopecks / KOPECKS_PER_UAH, currency: PIXEL_CURRENCY };

    this.send('track', event, parameters);
  }

  /**
   * Reports one `PageView`, unless this path has just been reported.
   *
   * No URL is passed: the pixel reads `location.href` itself, and the router
   * has already written the new address by the time `NavigationEnd` fires. A
   * query string is deliberately part of the comparison — it changes the page
   * as far as the pixel is concerned.
   */
  private reportPageView(url: string): void {
    if (url === this.lastReported) return;

    // Recorded whether or not the pixel answers, because the question it
    // answers is "has this navigation been handled", not "did Meta hear us".
    this.lastReported = url;

    this.send('track', 'PageView');
  }

  /**
   * Reports nothing more for the rest of this session.
   *
   * Two halves, because the pixel reports on its own as well as through this
   * service: Meta's script sends automatic events — button taps it recognises
   * — once it has been initialised, which it was at startup. Revoking consent
   * is Meta's own switch for all of it; the flag covers what goes through here.
   */
  suspend(): void {
    this.call('consent', 'revoke');
    this.suspended = true;
  }

  private send(command: string, event: string, parameters?: Record<string, unknown>): void {
    if (this.suspended) return;

    this.call(command, event, parameters);
  }

  private call(command: string, event: string, parameters?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const fbq = (this.document.defaultView as (Window & { fbq?: Fbq }) | null)?.fbq;
    // Absent whenever the loader did not run: outside production, behind an ad
    // blocker, on a WebView that could not reach the network. Analytics must
    // never be the reason a tap or a navigation throws.
    if (typeof fbq !== 'function') return;

    fbq(command, event, parameters);
  }

  /** Appends Meta's loader to the document head. */
  private load(pixelId: string): void {
    const script = this.document.createElement('script');
    script.textContent = LOADER.replace('%PIXEL_ID%', pixelId);

    this.document.head.appendChild(script);
  }
}
