/** One row of the per-referral breakdown the summary page renders. */
export interface ReferralEarningTotal {
  referredTelegramId: number
  /** Summed payouts, in USDT cents. */
  earned: number
  /** Summed source-order totals, in UAH kopecks. */
  soldVolume: number
}
