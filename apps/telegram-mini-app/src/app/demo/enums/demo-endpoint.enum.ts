/**
 * Every endpoint the Mini App calls, by what a demo account does with it.
 *
 * A route in `DEMO_ROUTES` names one of these, and `DemoModeService` answers
 * each through a `Record` with no fallback — so a member added here without a
 * way to answer it does not compile.
 */
export enum DemoEndpoint {
  // Sent to the server as they are: the launch itself, the live rates, and
  // reading a jar the promoter pasted — a real one, which is theirs.
  AUTH = 'AUTH',
  RATES = 'RATES',
  RESOLVE_JAR_LINK = 'RESOLVE_JAR_LINK',

  // Answered from the pack.
  PROFILE = 'PROFILE',
  HISTORY = 'HISTORY',
  REFERRAL = 'REFERRAL',
  INCOME = 'INCOME',
  TRUST_LADDER = 'TRUST_LADDER',
  SALE_CONFIG = 'SALE_CONFIG',
  SALE_LIST = 'SALE_LIST',
  SALE_DETAIL = 'SALE_DETAIL',
  SALE_PROGRESS = 'SALE_PROGRESS',
  DEPOSIT_CONFIG = 'DEPOSIT_CONFIG',
  DEPOSIT_LIST = 'DEPOSIT_LIST',
  DEPOSIT_DETAIL = 'DEPOSIT_DETAIL',
  FIAT_OPTIONS = 'FIAT_OPTIONS',
  FIAT_WATCH = 'FIAT_WATCH',
  FIAT_ACTIVE = 'FIAT_ACTIVE',
  FIAT_DETAIL = 'FIAT_DETAIL',

  // Acted out on the device: the button works and nothing is sent.
  SALE_CREATE = 'SALE_CREATE',
  DEPOSIT_CREATE = 'DEPOSIT_CREATE',
  FIAT_CREATE = 'FIAT_CREATE',

  // Refused on the device, the way the server would refuse it.
  REFUSED = 'REFUSED'
}
