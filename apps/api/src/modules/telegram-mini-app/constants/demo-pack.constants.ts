/**
 * The story a demo account's screens tell, in the quantities that drive it.
 *
 * **Nothing the account shows is written down here.** Its balance is the sum
 * of the history drawn from these, its turnover is what those sales fetched,
 * and its referral earnings are the product's own rate applied to the listed
 * volumes — so tuning the story means tuning these, and the figures follow by
 * the same arithmetic a real account's do. A balance typed in directly is the
 * one thing a viewer checking the history against it would catch.
 */
export const DemoHistoryShape = {
  /** How far back the history reaches, in days. */
  HISTORY_DAYS: 42,
  /** Rounds of "top up, then sell" across that period, oldest first. */
  CYCLES: 6,
  /** Chance a round tops up twice before it sells. */
  SECOND_TOP_UP_CHANCE: 0.35,
  /** Chance a round sells twice. */
  SECOND_SALE_CHANCE: 0.45,
  /** Share of top-ups paid in hryvnia rather than sent as USDT. */
  FIAT_TOP_UP_SHARE: 0.7,
  /** Share of sales paid out to the seller's own card rather than a jar. */
  CARD_SALE_SHARE: 0.5,
  /** A hryvnia top-up, in whole hryvnias — drawn in tens, the way payouts come. */
  FIAT_TOP_UP_MIN_UAH: 8_000,
  FIAT_TOP_UP_MAX_UAH: 40_000,
  /** A USDT top-up, in whole USDT. */
  CRYPTO_TOP_UP_MIN_USDT: 150,
  CRYPTO_TOP_UP_MAX_USDT: 900,
  /** What a sale stakes, as a share of the balance it is made from. */
  SALE_STAKE_MIN_SHARE: 0.55,
  SALE_STAKE_MAX_SHARE: 0.9,
  /** Smallest stake worth drawing, in whole USDT. */
  SALE_MIN_STAKE_USDT: 20,
  /** Payments one sale is filled by, at most. */
  SALE_MAX_PAYMENTS: 3,
  /**
   * The waking hours every step of the history falls in, in UTC — nine in the
   * morning to ten at night in Kyiv. A sale at four in the morning is the kind
   * of detail a viewer remembers.
   */
  DAYTIME_START_HOUR_UTC: 6,
  DAYTIME_HOURS: 13,
  /** Hours before "now" the last top-up lands, so the history ends today. */
  LAST_TOP_UP_MIN_HOURS: 1,
  LAST_TOP_UP_MAX_HOURS: 5,
  /**
   * How far the rate wanders across the history, as a fraction of today's.
   *
   * Hryvnia against USDT moves slowly; a percent either way over six weeks is
   * what a reader who remembers last month's rate would find believable.
   */
  RATE_DRIFT: 0.008,
  /** Days per radian of that wander — roughly a two-month swing. */
  RATE_DRIFT_PERIOD_DAYS: 9
} as const

/**
 * Hours between the steps of one round, each measured from the step before.
 *
 * Their maxima add up to under the length of a round
 * (`HISTORY_DAYS / CYCLES`), so one round never runs into the next.
 */
export const DemoCycleGapsHours = {
  FIRST_TOP_UP_MAX: 12,
  SECOND_TOP_UP_MIN: 3,
  SECOND_TOP_UP_MAX: 20,
  FIRST_SALE_MIN: 6,
  FIRST_SALE_MAX: 48,
  SECOND_SALE_MIN: 3,
  SECOND_SALE_MAX: 30,
  TRANSFER_MIN: 2,
  TRANSFER_MAX: 20
} as const

/**
 * The rounds that end with the referral pot moved across to the balance.
 *
 * How much each moves is not chosen here: it is `TRANSFER_SHARE` of what the
 * people who had joined by that day could have earned, less what earlier
 * transfers took — see `priceTransfers`.
 */
export const DEMO_REFERRAL_TRANSFER_ROUNDS: readonly number[] = [2, 4]

/**
 * The people who joined through a demo account's link.
 *
 * A few who sell a lot, a handful who sell some, and a tail who joined and
 * mostly did not — which is what a real referral list looks like, and what
 * makes the earnings beside it plausible at a tenth of a percent.
 */
export const DemoReferralShape = {
  COUNT_MIN: 14,
  COUNT_MAX: 22,
  /** The most recent a referral can have joined, in days before now. */
  JOINED_MIN_DAYS_AGO: 1,
  /** The heaviest sellers, first in every list. */
  WHALES: 2,
  /**
   * The earliest a heavy seller joined, in days before now: before the first
   * round that moves the pot, so there is something in it to move.
   */
  WHALE_JOINED_MIN_DAYS_AGO: 32,
  WHALE_MIN_UAH: 400_000,
  WHALE_MAX_UAH: 1_200_000,
  /** Steady sellers after them. */
  ACTIVE: 5,
  ACTIVE_MIN_UAH: 15_000,
  ACTIVE_MAX_UAH: 120_000,
  /** Everybody else sold a little, or nothing at all. */
  SMALL_SELLER_CHANCE: 0.45,
  SMALL_MIN_UAH: 1_000,
  SMALL_MAX_UAH: 12_000,
  /**
   * Share who opted into showing their name. Low, because names are opt-in and
   * a list of mostly masked ids is what every real referrer sees.
   */
  NAMED_CHANCE: 0.3,
  /** Share of named referrals who show a surname initial after the first name. */
  INITIAL_CHANCE: 0.5,
  /**
   * How much of the pot a transfer moves. Most of it: people move what they
   * have, and what is left behind, with what has arrived since, is the balance
   * the page shows today.
   */
  TRANSFER_SHARE: 0.9
} as const

/** The hryvnia amounts a demo account's top-up screen offers. */
export const DemoFiatOfferShape = {
  COUNT: 8,
  MIN_UAH: 500,
  MAX_UAH: 30_000
} as const

/**
 * Spacing between the steps of one operation, in minutes — how long a payer
 * took, how long a receipt took to read.
 */
export const DemoTimingMinutes = {
  PAYMENT_GAP_MIN: 4,
  PAYMENT_GAP_MAX: 25,
  MATCH_DELAY_MIN: 1,
  MATCH_DELAY_MAX: 8,
  RECEIPT_DELAY_MIN: 4,
  RECEIPT_DELAY_MAX: 12,
  TX_CONFIRM_MIN: 6,
  TX_CONFIRM_MAX: 25
} as const

/** The same, for the steps that take seconds rather than minutes. */
export const DemoTimingSeconds = {
  TERMINAL_READY: 5,
  COMPLETION_MIN: 1,
  COMPLETION_MAX: 20,
  RECEIPT_READ_MIN: 20,
  RECEIPT_READ_MAX: 90
} as const

/**
 * The first digit of the recipient card a demo top-up shows: the two networks
 * nearly every Ukrainian card is on, so the number reads as an ordinary card
 * while failing the check that would let anybody pay it.
 */
export const DEMO_CARD_NETWORK_PREFIXES: readonly string[] = ['4', '5']

/**
 * Ranges for the numbers Transacto would have assigned — terminals, cards and
 * orders. Drawn only so rows have distinct keys; none is shown as a figure.
 */
export const DemoUpstreamIds = {
  TERMINAL_MIN: 1_000,
  TERMINAL_MAX: 9_999,
  CARD_MIN: 10_000,
  CARD_MAX: 99_999,
  ORDER_MIN: 20_000,
  ORDER_MAX: 99_999
} as const

/**
 * Mixed into the account id before it seeds the story, so two accounts whose
 * ids differ by one do not start from neighbouring states.
 */
export const DEMO_SEED_SALT = 0x9e3779b9

/**
 * First names a demo referral may show, when it shows one.
 *
 * Invented in the only sense that matters: first names alone, the commonest
 * there are, never paired with a surname. A generated `@username` is exactly
 * what this list avoids — any handle is somebody's, and that somebody would
 * then appear in an advertisement as a stranger's referral.
 */
export const DEMO_REFERRAL_FIRST_NAMES: readonly string[] = [
  'Олександр',
  'Марина',
  'Андрій',
  'Ірина',
  'Дмитро',
  'Олена',
  'Максим',
  'Юлія',
  'Сергій',
  'Наталія',
  'Богдан',
  'Катерина',
  'Віталій',
  'Тетяна',
  'Роман',
  'Софія'
]

/** Surname initials a named referral may carry after the first name. */
export const DEMO_REFERRAL_INITIALS: readonly string[] = [
  'К.',
  'М.',
  'П.',
  'С.',
  'Т.',
  'Л.',
  'Г.',
  'В.'
]
