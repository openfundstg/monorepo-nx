/**
 * Minimal `chrome` stub for jsdom.
 *
 * Components reach for extension APIs during construction — `App` calls
 * `chrome?.i18n?.getUILanguage()`. Optional chaining does not help there:
 * `chrome` is an *undeclared identifier* under jsdom, not an undefined value,
 * so the expression throws ReferenceError before `?.` is ever evaluated.
 *
 * Extend this as more surface gets exercised by tests.
 */
const chromeStub = {
  i18n: {
    getUILanguage: () => 'en-US'
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined
    }
  },
  runtime: {
    getURL: (path: string) => path,
    onInstalled: { addListener: () => undefined }
  },
  alarms: {
    create: () => undefined,
    onAlarm: { addListener: () => undefined }
  },
  tabs: { create: async () => undefined },
  windows: { create: async () => undefined }
};

(globalThis as unknown as { chrome?: unknown }).chrome ??= chromeStub;
