import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { NavigationEnd, provideRouter, Router, type Event } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { MiniAppStartParam, saleStartParam } from '@transacto/contracts';
import { Subject } from 'rxjs';
import { AppComponent } from './app';
import { TmaService } from './auth/services/tma.service';
import { LanguageService } from './shared/services/language.service';

/**
 * The shell publishes Telegram's safe-area insets as CSS variables, and
 * `styles.scss` derives the same two from the `--tg-*-safe-area-inset-*`
 * variables Telegram maintains itself. An inline style beats a stylesheet, so
 * the shell writing a zero does not mean "no inset" — it means the fallback is
 * overwritten and every page title ends up under Telegram's own controls.
 */
describe('AppComponent safe-area insets', () => {
  const topInset = signal(0);
  const bottomInset = signal(0);

  const root = () => document.documentElement;
  const inlineValue = (name: string) => root().style.getPropertyValue(name);

  const createShell = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: TmaService,
          useValue: {
            topInset,
            bottomInset,
            init: () => undefined,
            user: () => null,
            startParam: () => '',
            setChromeColor: () => undefined,
          },
        },
        { provide: LanguageService, useValue: { init: () => Promise.resolve() } },
      ],
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    return fixture;
  };

  beforeEach(() => {
    topInset.set(0);
    bottomInset.set(0);
    root().style.removeProperty('--app-safe-top');
    root().style.removeProperty('--app-safe-bottom');
  });

  afterEach(() => {
    root().style.removeProperty('--app-safe-top');
    root().style.removeProperty('--app-safe-bottom');
  });

  it('publishes an inset the JS API reports', () => {
    topInset.set(104);
    bottomInset.set(34);

    createShell();

    expect(inlineValue('--app-safe-top')).toBe('104px');
    expect(inlineValue('--app-safe-bottom')).toBe('34px');
  });

  /**
   * The regression. `safeAreaInset` is Bot API 8.0+ and on some clients is
   * populated after `ready()` without `safeAreaChanged` ever firing, so zero
   * here means "we do not know" far more often than it means "there is no
   * inset" — while Telegram's own CSS variables hold the real numbers.
   */
  it('leaves the stylesheet fallback alone when the JS API reports nothing', () => {
    createShell();

    expect(inlineValue('--app-safe-top')).toBe('');
    expect(inlineValue('--app-safe-bottom')).toBe('');
  });

  /** Exiting fullscreen must hand control back, not pin a stale figure. */
  it('clears a previously published inset when it drops to zero', async () => {
    topInset.set(104);
    const fixture = createShell();
    expect(inlineValue('--app-safe-top')).toBe('104px');

    topInset.set(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(inlineValue('--app-safe-top')).toBe('');
  });
});

/**
 * The shell also hands Telegram the app's own background colour, so the header
 * strip Telegram draws above the web view stops being a different grey from the
 * page under it.
 *
 * The colour is read from the `--c-bg` design token rather than written in
 * TypeScript, which is the only reason there is one palette and not two — and
 * the reason this needs a test: the production build loads its stylesheet
 * asynchronously, so the token is routinely absent at the moment the shell
 * boots, and a blank read must wait rather than be sent.
 */
describe('AppComponent Telegram chrome', () => {
  const root = () => document.documentElement;
  const sent: string[] = [];

  const createShell = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: TmaService,
          useValue: {
            topInset: signal(0),
            bottomInset: signal(0),
            init: () => undefined,
            user: () => null,
            startParam: () => '',
            setChromeColor: (color: string) => sent.push(color),
          },
        },
        { provide: LanguageService, useValue: { init: () => Promise.resolve() } },
      ],
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    return fixture;
  };

  beforeEach(() => {
    sent.length = 0;
    root().style.removeProperty('--c-bg');
  });

  afterEach(() => root().style.removeProperty('--c-bg'));

  it('forwards the palette token Telegram should paint its chrome with', () => {
    root().style.setProperty('--c-bg', '#0d1017');

    createShell();

    expect(sent).toEqual(['#0d1017']);
  });

  /**
   * The regression this guards. Telegram rejects an empty colour and some
   * clients fall back to *white* — the one result worse than leaving the
   * default grey, on a page whose whole palette is dark.
   */
  it('sends nothing when the stylesheet has not applied yet', () => {
    createShell();

    expect(sent).toEqual([]);
  });
});


/**
 * The bot's "your amount appeared" message is the reason this exists, and the
 * amount it names can be taken by another trader in seconds — so landing on the
 * dashboard and asking the user to find the top-up list is the failure mode.
 *
 * It shipped past one review broken: the check was `url === '/'`, and a real
 * launch URL carries `initData` in the fragment, so `urlAfterRedirects` is
 * `/#tgWebAppData=…` and never the bare slash. Both cases below are here
 * because only the second one distinguishes the fix from the bug.
 */
describe('AppComponent opening on the launch link', () => {
  const LAUNCH_URL = '/#tgWebAppData=user%3D%7B%22id%22%3A1%7D&tgWebAppStartParam=topup'

  let navigate: ReturnType<typeof vi.spyOn>
  let events: Subject<Event>

  const build = (startParam: string): AppComponent => {
    events = new Subject<Event>()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: TmaService,
          useValue: {
            topInset: signal(0),
            bottomInset: signal(0),
            colorScheme: () => 'dark',
            user: () => null,
            startParam: () => startParam,
            init: vi.fn(),
            setChromeColor: vi.fn(),
          },
        },
      ],
    })

    // The real `Router`, because the fix under test uses its own `parseUrl` —
    // a stub would let a re-implemented URL comparison pass here and fail in
    // Telegram, which is the exact failure this suite exists to catch.
    const router = TestBed.inject(Router)
    Object.defineProperty(router, 'events', { get: () => events })
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true)

    return TestBed.runInInjectionContext(() => new AppComponent())
  }

  const settle = (url: string): void => {
    events.next(new NavigationEnd(1, url, url))
  }

  it('opens the top-up list from a launch URL carrying the fragment', () => {
    const component = build(MiniAppStartParam.TOP_UP)
    component.ngOnInit()

    settle(LAUNCH_URL)

    expect(navigate).toHaveBeenCalledWith(['/deposit/fiat'])
  })

  /** Somebody already elsewhere by the time this fires is somewhere they chose. */
  it('leaves a user who has already navigated where they are', () => {
    const component = build(MiniAppStartParam.TOP_UP)
    component.ngOnInit()

    settle('/sale/abc#tgWebAppData=x')

    expect(navigate).not.toHaveBeenCalled()
  })

  it('does nothing for a payload it does not recognise', () => {
    const component = build('Z38SL69F')
    component.ngOnInit()

    settle(LAUNCH_URL)

    expect(navigate).not.toHaveBeenCalled()
  })

  /**
   * The bot's *Open the sale* key.
   *
   * It used to carry no payload at all, which makes a `t.me/<bot>` link — a bot
   * chat, not this app, and often not even the chat the person was already in.
   * Pressing it did nothing they could see, which is exactly how it was
   * reported.
   */
  it('opens the sale named by a sale payload', () => {
    const component = build(saleStartParam('68cbf4a1c2d3e4f5a6b7c8d9'))
    component.ngOnInit()

    settle(LAUNCH_URL)

    expect(navigate).toHaveBeenCalledWith(['/sale', '68cbf4a1c2d3e4f5a6b7c8d9', 'status'])
  })

  /**
   * A payload is free text on a link anybody can write, and whatever comes out
   * of it becomes a route segment. One that is not an id is not a sale.
   */
  it('ignores a sale payload that does not carry an id', () => {
    const component = build('sale_not-an-id')
    component.ngOnInit()

    settle(LAUNCH_URL)

    expect(navigate).not.toHaveBeenCalled()
  })
})
