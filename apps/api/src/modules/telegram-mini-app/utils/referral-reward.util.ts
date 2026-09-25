/**
 * A referrer's cut of one sale, in USDT cents.
 *
 * `fiatAmount` is UAH kopecks and `exchangeRate` is UAH kopecks per USDT, so
 * `kopecks × percent / 100` gives kopecks of reward, dividing by the rate gives
 * USDT, and multiplying by 100 gives cents — the ×100 and ÷100 cancel, which is
 * why the expression looks shorter than the derivation.
 *
 * The caller passes the order's own snapshotted rate rather than today's, so a
 * payout is worth what the order was priced at.
 *
 * One home, because a demo account's referral list is drawn with it too: a
 * promoter showing earnings the product's own arithmetic could not have paid
 * would be showing figures anyone can check against the rate on the same page.
 */
export const referralRewardCents = (
  fiatAmount: number,
  exchangeRate: number,
  ratePercent: number
): number => {
  if (exchangeRate <= 0) return 0

  return Math.round((fiatAmount * ratePercent) / exchangeRate)
}
