/**
 * The figures that decide whether an account may become a demo account.
 *
 * Structural rather than a whole user, so the admin panel's list row and the
 * backend's stored document both satisfy it without a conversion.
 */
export interface DemoEligibilityFigures {
  /** USDT cents, spendable. */
  readonly balance: number;
  /** USDT cents, staked against running sales. */
  readonly frozenBalance: number;
  /** Sales holding a slot right now. */
  readonly openOrders: number;
}

/**
 * Whether an account holds no money and is running nothing — the only kind
 * that may be turned into a demo account.
 *
 * A demo account shows invented figures and has every write refused, so
 * switching a real, funded account over would hide its money from its owner
 * and stop them moving it. The referral pot is deliberately not part of the
 * rule: it cannot fund anything until it is transferred, and a promoter whose
 * link has already earned them something is exactly who this is for.
 *
 * Shared so the panel hides the action on a row the server would refuse. The
 * server checks again — the row may have moved since it was drawn — and adds
 * the one condition a row cannot show: a hryvnia top-up in flight.
 */
export const isDemoEligible = (account: DemoEligibilityFigures): boolean =>
  account.balance === 0 && account.frozenBalance === 0 && account.openOrders === 0;
