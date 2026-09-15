/**
 * One person who joined through the caller's referral link.
 *
 * Identity is opt-in. `displayName` is `null` unless that user ticked
 * "show my name to my referrer" in their own settings, and `maskedId` is always
 * present — a stable pseudonym derived per (referrer, referred) pair, so the
 * referrer can follow one row over time without ever learning who it is.
 *
 * The client renders `REFERRAL.MASKED_USER` with `maskedId` as its parameter
 * when `displayName` is `null`; the label itself is never sent, because it is
 * user-facing text.
 */
export interface ReferralEntry {
  /** Stable, opaque, and scoped to this referrer. Never a Telegram id. */
  maskedId: string;
  /** `@username`, or first + last name, or `null` when the user opted out. */
  displayName: string | null;
  /** Lifetime USDT cents this person has earned the caller. `0` is normal. */
  earned: number;
  /** UAH kopecks this person has successfully sold. */
  soldVolume: number;
  /** ISO string — when they joined through the link. */
  joinedAt: string;
}

/**
 * Everything the Referral page renders, as one snapshot.
 *
 * All money is **USDT cents**, matching `TmaUser.balance`: the referral balance
 * is credited in the same unit it will be transferred into, so moving it is a
 * 1:1 move with no rate applied at transfer time.
 */
export interface ReferralSummary {
  /** The caller's own code, e.g. `Z38SL69F`. */
  code: string;
  /** Ready-to-share deep link, built server-side from the bot username. */
  link: string;
  /** Percentage of a referral's sold volume the caller earns, e.g. `0.1`. */
  ratePercent: number;
  /** Spendable only by transferring it to the main balance. USDT cents. */
  balance: number;
  /** Lifetime earnings, including everything already transferred out. */
  totalEarned: number;
  /** Total UAH kopecks sold by everyone below the caller. */
  totalVolume: number;
  /**
   * The code the caller themselves joined through, or `null` if nobody invited
   * them.
   *
   * Deliberately the code and not the referrer's name: the caller already had
   * this string — they clicked or typed it — so echoing it back discloses
   * nothing, whereas resolving it to a person would leak an identity the
   * referrer never agreed to share.
   */
  invitedBy: string | null;
  /**
   * Whether the caller may still redeem a code manually. `false` once they
   * have a referrer, or once they have completed a sale.
   */
  canRedeemCode: boolean;
  /** Highest earner first; people who joined but never sold sort last. */
  referrals: readonly ReferralEntry[];
}

/** `POST /tma/referral/redeem` — bind the caller to someone else's code. */
export interface RedeemReferralCodeReq {
  code: string;
}

/** `POST /tma/referral/transfer` — move referral money to the main balance. */
export interface TransferReferralReq {
  /** USDT cents. Must be positive and within the referral balance. */
  amount: number;
}

/** What both mutations return, so the client can repaint without a refetch. */
export interface ReferralBalancesRes {
  /** USDT cents left on the referral balance. */
  referralBalance: number;
  /** USDT cents on the main, spendable balance. */
  balance: number;
}

/** `PATCH /tma/referral/name-visibility` — the caller's own privacy choice. */
export interface ReferralNameVisibilityReq {
  /** `true` shows the caller's name to whoever invited them. */
  showNameToReferrer: boolean;
}

/** Payload of `TmaWsEventNames.REFERRAL_BALANCE_UPDATED`. */
export interface ReferralBalanceUpdateEvent {
  /** USDT cents currently on the referral balance. */
  referralBalance: number;
  /** Lifetime USDT cents earned, so the page's headline figure stays live. */
  totalEarned: number;
}
