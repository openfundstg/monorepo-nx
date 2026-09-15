import { Injectable, OnDestroy, computed, signal } from '@angular/core'

/** Pixels of screen edge covered by something we do not control. */
export interface SafeAreaInset {
  top: number
  bottom: number
  left: number
  right: number
}

const EMPTY_INSET: SafeAreaInset = { top: 0, bottom: 0, left: 0, right: 0 }

/**
 * Telegram events we subscribe to. Strings rather than an enum because they are
 * the SDK's own vocabulary, matched verbatim.
 */
const TelegramEvent = {
  SAFE_AREA_CHANGED: 'safeAreaChanged',
  CONTENT_SAFE_AREA_CHANGED: 'contentSafeAreaChanged',
  FULLSCREEN_CHANGED: 'fullscreenChanged',
} as const

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string
        initDataUnsafe: {
          user?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
            language_code?: string
          }
          auth_date?: number
          hash?: string
          /**
           * The `startapp` payload of the link that opened the app.
           *
           * Read from `initDataUnsafe` and therefore *not* trusted: the signed
           * copy is what the backend verifies, and the referral binding happens
           * there. Nothing here may turn this into a privilege — it decides
           * which screen opens first and nothing else.
           */
          start_param?: string
        }
        themeParams: Record<string, string>
        colorScheme: 'light' | 'dark'
        ready: () => void
        expand: () => void
        close: () => void
        /** Bot API 6.1. Absent on the desktop clients that predate it. */
        openTelegramLink?: (url: string) => void
        /**
         * Telegram's own chrome around the web view. Bot API 6.1+ for the
         * keyword forms, 6.9+ for an arbitrary hex, and 7.10+ for the bottom
         * bar — hence optional, and hence called through `?.`: an older client
         * simply keeps its default grey.
         */
        setHeaderColor?: (color: string) => void
        setBackgroundColor?: (color: string) => void
        setBottomBarColor?: (color: string) => void
        /**
         * Bot API 7.7+. Telegram's own swipe-down-to-collapse is a native
         * gesture that never sees a `preventDefault`; these are the only way
         * to hold the app open while something modal is being dragged on.
         * Optional, and called through `?.`: an older client keeps the gesture.
         */
        disableVerticalSwipes?: () => void
        enableVerticalSwipes?: () => void
        /**
         * Bot API 8.0+. All optional because a client older than that exposes
         * none of them — and cannot launch in fullscreen either, so there is
         * nothing to compensate for when they are missing.
         */
        isFullscreen?: boolean
        /** Device furniture: the status bar, a notch, the gesture pill. */
        safeAreaInset?: SafeAreaInset
        /** Telegram's own overlaid controls — back, collapse, ⋮ — in fullscreen. */
        contentSafeAreaInset?: SafeAreaInset
        onEvent?: (event: string, callback: () => void) => void
        offEvent?: (event: string, callback: () => void) => void
        BackButton: {
          show: () => void
          hide: () => void
          onClick: (cb: () => void) => void
          offClick: (cb: () => void) => void
        }
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void
          selectionChanged: () => void
        }
        /**
         * Bot API 6.9+ — optional because older clients, and any browser during
         * `nx serve`, simply do not expose it. `TmaStorageService` falls back to
         * `localStorage`, so nothing may assume this is present.
         *
         * The callbacks are Telegram's own shape: an error string (or `null`)
         * first, the result second.
         */
        CloudStorage?: {
          setItem: (
            key: string,
            value: string,
            callback?: (error: string | null, stored?: boolean) => void,
          ) => void
          getItem: (
            key: string,
            callback: (error: string | null, value?: string) => void,
          ) => void
        }
        MainButton: {
          text: string
          color: string
          textColor: string
          isVisible: boolean
          isActive: boolean
          show: () => void
          hide: () => void
          onClick: (cb: () => void) => void
          offClick: (cb: () => void) => void
          setText: (text: string) => void
          enable: () => void
          disable: () => void
          showProgress: (leaveActive: boolean) => void
          hideProgress: () => void
        }
      }
    }
  }
}

@Injectable({ providedIn: 'root' })
export class TmaService implements OnDestroy {
  private readonly _initData = signal<string>('')
  /**
   * The `startapp` payload this launch carried, or `''`.
   *
   * Captured at init because that is when the SDK is read; the app uses it once,
   * to open on the screen the link was about. See {@link MiniAppStartParam} for
   * the payloads that mean anything — everything else, a referral code included,
   * is the backend's business and is ignored here.
   */
  private readonly _startParam = signal<string>('')
  private readonly _user = signal<{
    id: number
    first_name: string
    last_name?: string
    username?: string
    language_code?: string
  } | null>(null)
  private readonly _colorScheme = signal<'light' | 'dark'>('dark')

  private readonly _safeArea = signal<SafeAreaInset>(EMPTY_INSET)
  private readonly _contentSafeArea = signal<SafeAreaInset>(EMPTY_INSET)
  private readonly _isFullscreen = signal(false)

  readonly initData = this._initData.asReadonly()
  readonly user = this._user.asReadonly()
  readonly startParam = this._startParam.asReadonly()
  readonly colorScheme = this._colorScheme.asReadonly()
  readonly isFullscreen = this._isFullscreen.asReadonly()

  /**
   * Pixels at the top of the viewport that something else is already drawing
   * on, and which our own content must start below.
   *
   * The two insets stack rather than overlap: `safeAreaInset.top` is the
   * device's status bar and notch, and `contentSafeAreaInset.top` is Telegram's
   * own controls *measured from inside that* — so in fullscreen on Android the
   * page title has to clear both the clock and the back button, which is
   * exactly the overlap this fixes.
   */
  readonly topInset = computed(() => this._safeArea().top + this._contentSafeArea().top)

  /** Gesture pill and navigation bar, for anything pinned to the bottom. */
  readonly bottomInset = computed(() => this._safeArea().bottom)

  private get webApp() {
    return window.Telegram?.WebApp
  }

  /**
   * Initialize the Telegram WebApp SDK.
   * Must be called in app initialization.
   */
  init(): void {
    const wa = this.webApp
    if (!wa) {
      console.warn('[TmaService] Telegram WebApp SDK not available')
      return
    }

    this._initData.set(wa.initData)
    this._user.set(wa.initDataUnsafe?.user ?? null)
    this._startParam.set(wa.initDataUnsafe?.start_param ?? '')
    this._colorScheme.set(wa.colorScheme)

    this.readInsets()
    // Re-read rather than trusting the values captured at launch: the status
    // bar can appear and vanish as the user rotates or enters fullscreen, and
    // `contentSafeAreaChanged` is the only notice we get that Telegram moved
    // its own buttons.
    wa.onEvent?.(TelegramEvent.SAFE_AREA_CHANGED, this.onInsetsChanged)
    wa.onEvent?.(TelegramEvent.CONTENT_SAFE_AREA_CHANGED, this.onInsetsChanged)
    wa.onEvent?.(TelegramEvent.FULLSCREEN_CHANGED, this.onInsetsChanged)

    wa.ready()
    wa.expand()
  }

  ngOnDestroy(): void {
    const wa = this.webApp
    wa?.offEvent?.(TelegramEvent.SAFE_AREA_CHANGED, this.onInsetsChanged)
    wa?.offEvent?.(TelegramEvent.CONTENT_SAFE_AREA_CHANGED, this.onInsetsChanged)
    wa?.offEvent?.(TelegramEvent.FULLSCREEN_CHANGED, this.onInsetsChanged)
  }

  /** Arrow property so it keeps its `this` when handed to the SDK. */
  private readonly onInsetsChanged = (): void => this.readInsets()

  private readInsets(): void {
    const wa = this.webApp
    if (!wa) return

    // A client older than Bot API 8.0 reports none of this — and cannot launch
    // fullscreen either, so zero is the right answer rather than a gap.
    this._safeArea.set(wa.safeAreaInset ?? EMPTY_INSET)
    this._contentSafeArea.set(wa.contentSafeAreaInset ?? EMPTY_INSET)
    this._isFullscreen.set(wa.isFullscreen ?? false)
  }

  /**
   * Paints Telegram's own chrome to match the app's ground.
   *
   * Without this the header strip above the web view — and, in fullscreen, the
   * bar below it — stays whatever grey the client picked from `themeParams`,
   * leaving a visible seam along the top of every screen. The app draws its own
   * palette and ignores `themeParams`, so nothing else would ever close it.
   *
   * The colour is passed in rather than named here: it belongs to the
   * stylesheet, and `AppComponent` reads it back from the design token so the
   * two cannot drift apart.
   */
  setChromeColor(color: string): void {
    const wa = this.webApp
    if (!wa) return

    wa.setBackgroundColor?.(color)
    wa.setHeaderColor?.(color)
    wa.setBottomBarColor?.(color)
  }

  hapticFeedback(type: 'success' | 'error' | 'warning' | 'light' | 'medium' | 'heavy'): void {
    const wa = this.webApp
    if (!wa) return

    if (['success', 'error', 'warning'].includes(type)) {
      wa.HapticFeedback.notificationOccurred(type as 'success' | 'error' | 'warning')
    } else {
      wa.HapticFeedback.impactOccurred(type as 'light' | 'medium' | 'heavy')
    }
  }

  showBackButton(callback: () => void): void {
    this.webApp?.BackButton.show()
    this.webApp?.BackButton.onClick(callback)
  }

  hideBackButton(): void {
    this.webApp?.BackButton.hide()
  }

  /**
   * Holds the Mini App open against a downward drag.
   *
   * A modal overlay refuses the page's own scrolling, but Telegram collapses
   * the app on the same gesture at the native layer, where no listener of ours
   * can reach. No-op on clients without the call (Bot API < 7.7).
   */
  lockVerticalSwipes(): void {
    this.webApp?.disableVerticalSwipes?.()
  }

  unlockVerticalSwipes(): void {
    this.webApp?.enableVerticalSwipes?.()
  }

  /**
   * Opens a `t.me` link — the support bot — in Telegram itself.
   *
   * `openTelegramLink` and not `window.open`: inside the WebView the second
   * either opens a browser tab showing t.me's own "open in Telegram" page or is
   * blocked outright, and a user sent to support has to arrive in a chat rather
   * than at a landing page. Outside Telegram there is no SDK and the browser
   * gets the link, which is the only thing left to do with it.
   */
  openTelegramLink(url: string): void {
    const wa = this.webApp

    if (wa?.openTelegramLink) wa.openTelegramLink(url)
    else window.open(url, '_blank', 'noopener')
  }

  close(): void {
    this.webApp?.close()
  }
}
