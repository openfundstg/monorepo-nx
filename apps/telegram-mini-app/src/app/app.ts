import { ChangeDetectionStrategy, Component, OnInit, effect, inject } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  PRIMARY_OUTLET,
  Router,
  RouterOutlet
} from '@angular/router'
import { filter, map, startWith, take } from 'rxjs'
import { TranslateService } from '@ngx-translate/core'
import { MiniAppStartParam, saleIdFromStartParam } from '@transacto/contracts'
import { TmaService } from './auth/services/tma.service'
import { BottomNavComponent } from './shared/components/bottom-nav/bottom-nav.component'
import { LoadingOverlayComponent } from './shared/components/loading-overlay/loading-overlay.component'
import { LoadingService } from './shared/services/loading.service'
import { UpdateRequiredComponent } from './shared/components/update-required/update-required.component'
import { SessionExpiredComponent } from './auth/components/session-expired/session-expired.component'
import { SessionExpiryService } from './auth/services/session-expiry.service'
import { TourOverlayComponent } from './onboarding/components/tour-overlay/tour-overlay.component'
import { LanguageService } from './shared/services/language.service'
import { ZoomLockService } from './shared/services/zoom-lock.service'
import { AppVersionService } from './shared/services/app-version.service'
import { MetaPixelService } from './shared/services/meta-pixel.service'
import { APP_LANGUAGES } from './shared/enums/app-language.enum'
import { DEFAULT_LANGUAGE } from './shared/constants/language.const'
import {
  SPLASH_ELEMENT_ID,
  SPLASH_FADE_MS,
  SPLASH_LEAVING_CLASS
} from './shared/constants/splash.const'

/** Where `MiniAppStartParam.TOP_UP` lands — the hryvnia amounts list. */
const TOP_UP_ROUTE = '/deposit/fiat'

/** Where a `sale_<id>` payload lands, as `sale/routes.ts` spells it. */
const saleStatusRoute = (saleId: string): readonly string[] => ['/sale', saleId, 'status']

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    BottomNavComponent,
    TourOverlayComponent,
    LoadingOverlayComponent,
    UpdateRequiredComponent,
    SessionExpiredComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit {
  private readonly tma = inject(TmaService)
  private readonly translate = inject(TranslateService)
  private readonly language = inject(LanguageService)
  private readonly zoomLock = inject(ZoomLockService)
  /** Public: the shell's own template asks it whether the app is still current. */
  readonly version = inject(AppVersionService)
  /** Likewise — whether this launch's credential is still worth anything. */
  readonly session = inject(SessionExpiryService)
  /**
   * Injected for its constructor, which is where it starts following the
   * router. Named here rather than left to be created by whoever happens to
   * ask first: it has to be listening before the app navigates anywhere, and
   * a lazily-created analytics service would miss whatever came before it.
   */
  private readonly metaPixel = inject(MetaPixelService)
  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)
  private readonly loading = inject(LoadingService)

  /**
   * Whether the current screen is one of the nav's own destinations.
   *
   * Read off the route tree rather than matched against URL strings, so adding
   * a destination is a `data: { nav: true }` on its route and nothing here.
   * `startWith` covers the first paint: the initial navigation may already have
   * finished by the time this subscribes, and without it the nav would be
   * missing until the user navigated somewhere.
   */
  readonly showNav = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.routeWantsNav())
    ),
    { initialValue: false }
  )

  constructor() {
    this.translate.addLangs(APP_LANGUAGES.map((option) => option.code))
    this.translate.setFallbackLang(DEFAULT_LANGUAGE)
    this.trackNavigationLoading()
  }

  /**
   * Raises the same overlay the API interceptor uses while the router is
   * navigating — which is when a lazy route chunk is downloading. That fetch is
   * a dynamic `import()`, not an `HttpClient` call, so `loadingInterceptor`
   * never sees it: without this, tapping into a not-yet-loaded section left the
   * screen blank for however long the chunk took to cross the Tor onion. The
   * counter's delay still applies, so an already-cached (instant) navigation
   * never flashes.
   */
  private trackNavigationLoading(): void {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) this.loading.start()
      else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      )
        this.loading.stop()
    })
  }

  ngOnInit(): void {
    // `tma.init()` is not called here any more — it runs as an app initializer,
    // because the router's first navigation happens before this hook and both
    // `tmaGuard` and `tmaAuthInterceptor` need the credential by then.
    this.paintTelegramChrome()
    this.dismissSplashWhenRouted()
    this.followStartParam()
    // Registered by the shell so it covers every route, and once: a page that
    // did it for itself would leave the gesture unguarded on every other screen.
    this.zoomLock.lock()

    // Likewise once, and here rather than in an app initializer: it records
    // which build is running and then watches for it to be superseded, and
    // holding up the first paint for that would trade a real second of
    // start-up against a check that is allowed to take a minute.
    void this.version.start()

    // Reading the stored choice is asynchronous (CloudStorage is callback-based),
    // so the language settles a tick after the shell renders. `LanguageService`
    // swallows storage failures itself; anything that still escapes is a bug and
    // must be logged rather than lost in an unhandled rejection.
    this.language
      .init(this.tma.user()?.language_code)
      .catch((error: unknown) => console.error('[AppComponent] language init failed', error))
  }

  /**
   * Opens the screen the launch link was about.
   *
   * The bot's "a sum you asked for has appeared" message carries
   * `startapp=topup`, and the amount it names is a payout another trader can
   * take — so landing on the dashboard and asking the user to find their own
   * way to the top-up list is how somebody misses it.
   *
   * After the first navigation settles, not before: `tmaGuard` holds every
   * route until the server has ruled on the launch, and a navigation issued
   * ahead of that would be cancelled. Once, and only from the root — a user who
   * has already gone somewhere by the time this fires is somewhere they chose.
   *
   * An unrecognised payload does nothing here. A referral code is the common
   * one, and it is the backend's business: it arrives inside the *signed*
   * `initData` and is bound there.
   */
  private followStartParam(): void {
    const destination = this.routeForStartParam()
    if (destination === null) return

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1)
      )
      .subscribe((event) => {
        if (!this.isRootUrl((event as NavigationEnd).urlAfterRedirects)) return

        void this.router.navigate([...destination])
      })
  }

  /**
   * Where this launch's payload says to go, or `null` for one we do not act on.
   *
   * Two payloads today, and the second is why this is a lookup rather than a
   * comparison. The bot's card-sale message carries `sale_<id>`, because its
   * *Open the sale* key used to carry nothing at all — a bare `t.me/<bot>`
   * link, which opens a bot chat and not this app, so the key did nothing a
   * person could see.
   */
  private routeForStartParam(): readonly string[] | null {
    const param = this.tma.startParam()

    if (param === MiniAppStartParam.TOP_UP) return [TOP_UP_ROUTE]

    const saleId = saleIdFromStartParam(param)

    return saleId === null ? null : saleStatusRoute(saleId)
  }

  /**
   * Whether a settled navigation landed on the dashboard.
   *
   * **Not `url === '/'`**, which is what this was and why it never fired once.
   * A Mini App launch carries `initData` in the URL *fragment*, so the initial
   * navigation is built from `/#tgWebAppData=…&tgWebAppStartParam=topup`; the
   * router keeps that fragment, and `urlAfterRedirects` serializes back with it
   * attached. The string comparison therefore failed on every real launch and
   * matched only in a test — which is exactly how it shipped past review.
   *
   * Asking the router's own parser instead: the root route is the one with no
   * segments, whatever is hanging off the end of the URL.
   */
  private isRootUrl(url: string): boolean {
    const segments = this.router.parseUrl(url).root.children[PRIMARY_OUTLET]?.segments ?? []

    return segments.length === 0
  }

  /**
   * Takes down the launch screen `index.html` painted before the bundle loaded.
   *
   * Keyed to the router settling rather than to this component existing. The
   * shell is alive well before there is anything to look at: `tmaGuard` holds
   * every route until the server has ruled on the launch, so dismissing on
   * `ngOnInit` would trade the splash for the black screen it replaced.
   *
   * Cancel and error terminate a navigation just as end does, and are the two
   * outcomes that would otherwise leave the splash up for good — a redirect the
   * guard issues arrives as its own `NavigationEnd`, so the common case is
   * covered by the first of the three.
   */
  private dismissSplashWhenRouted(): void {
    const splash = document.getElementById(SPLASH_ELEMENT_ID)

    if (!splash) return

    this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError
        ),
        take(1)
      )
      .subscribe(() => {
        splash.classList.add(SPLASH_LEAVING_CLASS)
        setTimeout(() => splash.remove(), SPLASH_FADE_MS)
      })
  }

  /**
   * Publishes the safe-area insets as CSS variables for the stylesheets to use.
   *
   * A DOM write driven by a signal, which is what an `effect` is for. It runs
   * again whenever Telegram reports the insets moved — entering fullscreen,
   * rotating, a status bar appearing — so the layout follows rather than being
   * measured once at launch.
   *
   * `styles.scss` seeds the same two variables from Telegram's own
   * `--tg-*-safe-area-inset-*`, so a client that sets those but whose JS API we
   * failed to read still lays out correctly; this simply wins when present,
   * because an inline style beats a stylesheet.
   */
  private readonly publishInsets = effect(() => {
    const root = document.documentElement
    this.publishInset(root, '--app-safe-top', this.tma.topInset())
    this.publishInset(root, '--app-safe-bottom', this.tma.bottomInset())
  })

  /**
   * Sets the inline override, or clears it so the stylesheet's own value wins.
   *
   * The `else` is the whole point, and writing `0px` there instead is what put
   * every page title back under Telegram's controls. An inline style beats a
   * stylesheet, so an unconditional write means `styles.scss` — which derives
   * the same figure from the `--tg-*-safe-area-inset-*` variables Telegram
   * maintains itself — is not a fallback at all: it is dead code that the very
   * first effect run overwrites with a zero.
   *
   * And zero is what the JS API reports far more often than one would like.
   * `safeAreaInset` is Bot API 8.0+, absent on older clients, and on some
   * builds it is populated after `ready()` without `safeAreaChanged` ever
   * firing — so the values captured here stay empty while Telegram's CSS
   * variables hold the real numbers the whole time.
   *
   * Clearing costs nothing when the JS API is silent for the honest reason
   * that the inset really is zero: Telegram's variables read zero too, so the
   * fallback resolves to the same answer.
   */
  private publishInset(root: HTMLElement, name: string, value: number): void {
    if (value > 0) root.style.setProperty(name, `${value}px`)
    else root.style.removeProperty(name)
  }

  /**
   * Walks the activated route chain looking for the flag.
   *
   * The whole chain, not just the leaf: the flag sits on the top-level route
   * while the page itself is a lazily loaded empty-path child, and reading only
   * the deepest snapshot would depend on Angular's data-inheritance strategy
   * staying as it is.
   */
  private routeWantsNav(): boolean {
    let current: ActivatedRouteSnapshot | null = this.route.snapshot

    while (current) {
      if (current.data['nav'] === true) return true
      current = current.firstChild
    }

    return false
  }

  /**
   * Hands Telegram the app's own background colour for the chrome it draws.
   *
   * Read off the design token rather than written here as a hex: the palette
   * lives in `styles/_tokens.scss`, and a second copy in TypeScript would be
   * one repaint away from disagreeing with it — as a mismatched seam along the
   * top of every screen, which is the one place nobody looks when the colours
   * change.
   *
   * Why this is not a single `getComputedStyle` call: the production build
   * emits the stylesheet as `<link media="print" onload="this.media='all'">`,
   * the standard trick for loading CSS without blocking the first paint. So the
   * tokens are usually *not* in the CSSOM when the shell boots, and the first
   * read comes back blank. `load` is the one event guaranteed to fire after
   * every stylesheet has been applied, so a blank first read waits for it.
   *
   * If the document has already finished loading and the token is still blank,
   * the stylesheet is not coming — there is nothing left to wait for.
   */
  private paintTelegramChrome(): void {
    if (this.sendChromeColor() || document.readyState === 'complete') return

    window.addEventListener('load', () => this.sendChromeColor(), { once: true })
  }

  /**
   * A blank value must never be sent: Telegram rejects it and, on some clients,
   * falls back to white.
   *
   * @returns whether a colour was actually available to send.
   */
  private sendChromeColor(): boolean {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim()

    if (!background) return false

    this.tma.setChromeColor(background)

    return true
  }
}
