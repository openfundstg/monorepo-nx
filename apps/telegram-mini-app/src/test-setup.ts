/**
 * Minimal `Telegram.WebApp` stub for jsdom.
 *
 * `TmaService` reads `window.Telegram?.WebApp` — optional chaining is enough
 * there because `window` exists — but components that call `init()` or the
 * haptics during construction would otherwise silently no-op in a way that
 * diverges from the real app. Stubbing keeps tests honest about what is called.
 */
const noop = () => undefined;

Object.defineProperty(globalThis, 'Telegram', {
  writable: true,
  value: {
    WebApp: {
      initData: '',
      initDataUnsafe: {},
      themeParams: {},
      colorScheme: 'dark',
      ready: noop,
      expand: noop,
      close: noop,
      BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
      HapticFeedback: {
        impactOccurred: noop,
        notificationOccurred: noop,
        selectionChanged: noop,
      },
      // `TmaStorageService` promise-wraps these callbacks; a stub that never
      // called back would leave every `await` hanging until its timeout.
      // Reporting "no value" is the honest jsdom answer — it falls through to
      // the `localStorage` branch, exactly as an older Telegram client does.
      CloudStorage: {
        getItem: (_key: string, callback: (error: string | null, value?: string) => void) =>
          callback(null, undefined),
        setItem: (
          _key: string,
          _value: string,
          callback?: (error: string | null, stored?: boolean) => void,
        ) => callback?.(null, true),
      },
      MainButton: {
        text: '',
        color: '',
        textColor: '',
        isVisible: false,
        isActive: false,
        show: noop,
        hide: noop,
        onClick: noop,
        offClick: noop,
        setText: noop,
        enable: noop,
        disable: noop,
        showProgress: noop,
        hideProgress: noop,
      },
    },
  },
});
