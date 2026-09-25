/** What one step of a demo account's generated history does to its balance. */
export enum DemoStepKind {
  /** Money arrives — hryvnia paid to a payout, or USDT sent on chain. */
  TOP_UP = 'TOP_UP',
  /** A sale stakes part of the balance and fills. */
  SALE = 'SALE',
  /** Referral earnings moved across to the spendable balance. */
  REFERRAL_TRANSFER = 'REFERRAL_TRANSFER'
}
