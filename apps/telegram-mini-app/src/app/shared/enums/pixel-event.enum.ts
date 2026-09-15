/**
 * The events this app reports to the Meta Pixel.
 *
 * Two kinds, deliberately kept apart. {@link PixelStandardEvent} are Meta's own
 * names, and its optimiser acts on what it believes they mean — so a name is
 * used here only where the meaning genuinely matches. Everything else is a
 * {@link PixelTapEvent}, reported through `trackCustom`, which says what
 * happened and claims nothing more.
 *
 * Calling an ordinary button press `Purchase` would not merely be untidy: ad
 * delivery is optimised toward whatever the pixel calls a conversion, so a
 * wrong name spends real money chasing the wrong people.
 */
export enum PixelStandardEvent {
  /** A Telegram account opened the Mini App for the first time. */
  COMPLETE_REGISTRATION = 'CompleteRegistration',
  /**
   * USDT was funded. Meta's nearest name for money entering an account, and it
   * fits: a deposit is a payment the user actually makes.
   */
  ADD_PAYMENT_INFO = 'AddPaymentInfo',
  /** A sale was created and its stake frozen. */
  INITIATE_CHECKOUT = 'InitiateCheckout',
  /**
   * A sale reached its target.
   *
   * The event closest to revenue, which is what an ad campaign should be
   * optimised toward — not the deposit that funded it, and certainly not a tap.
   */
  PURCHASE = 'Purchase',
}

/** Taps worth counting, reported as custom events. */
export enum PixelTapEvent {
  NAV_DASHBOARD = 'TapNavDashboard',
  NAV_REFERRAL = 'TapNavReferral',
  NAV_SETTINGS = 'TapNavSettings',
  START_SALE = 'TapStartSale',
  START_DEPOSIT = 'TapStartDeposit',
  SELECT_BANK = 'TapSelectBank',
  STOP_SALE = 'TapStopSale',
}

/**
 * ISO 4217, which is what Meta's `currency` expects.
 *
 * Every value reported is in hryvnia, including a deposit — that is priced in
 * USDT, which is not a currency Meta knows, so it is reported at its own
 * exchange rate instead. One unit throughout means the figures in Ads Manager
 * add up.
 */
export const PIXEL_CURRENCY = 'UAH';
