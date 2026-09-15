export const environment = {
  production: true,
  /** The mini app is served from the same origin as the API in production. */
  apiUrl: 'https://openfunds.top/api/tma',
  wsUrl: 'https://openfunds.top',
  /**
   * Meta Pixel id, and the switch that decides whether the pixel exists at all.
   *
   * Empty in development: the tag used to sit in `index.html`, so every local
   * run reported page views into the same figures the ad campaigns are measured
   * on. Keeping the id here rather than in the markup is what makes "production
   * only" a property of the configuration instead of a check somewhere in the
   * code.
   */
  metaPixelId: '952959427063504',
  /**
   * Where the gate screen sends somebody who opened this outside Telegram.
   *
   * Empty hides the link rather than offering a broken one. Empty in
   * development because there is nothing useful to point a local run at.
   */
  botUrl: 'https://t.me/open_funds_bot'
} as const
