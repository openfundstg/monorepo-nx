export const environment = {
  production: false,
  /**
   * Same-origin in development: `proxy.conf.json` forwards /api to the backend,
   * which keeps the Telegram initData header on a same-site request.
   */
  apiUrl: '/api/tma',
  wsUrl: '',
  /** No pixel outside production — see the note on the production value. */
  metaPixelId: '',
  /**
   * Where the gate screen sends somebody who opened this outside Telegram.
   *
   * Empty hides the link rather than offering a broken one. Empty in
   * development because there is nothing useful to point a local run at.
   */
  botUrl: ''
} as const
