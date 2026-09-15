/**
 * Why a user's spendable balance moved.
 *
 * The kinds of one append-only book — `tma_balance_entries` — which every write
 * that touches `balance` appends to. Before it existed the balance was a bare
 * `$inc` in eight different places and only three of them left a document
 * behind, so "why is this number what it is" had no answer for the other five:
 * a referral transfer, an operator's correction and a sale's stake
 * moved money and explained nothing.
 *
 * Two rules keep the book honest, and both are about what it does *not* cover:
 *
 * - Only the **spendable** balance. Committing a frozen stake and crediting the
 *   referral pot move other pots and are not booked here — the sale and
 *   `tma_referral_earnings` account for those. So the sum of a user's entries
 *   equals their `balance`, exactly, and anything else would break that.
 * - A movement, never a process. A reserved top-up or a pending deposit has no
 *   entry until the money actually lands, because an entry is a thing that
 *   happened.
 */
export enum BalanceEntryKind {
  /** A crypto deposit was verified and credited. */
  DEPOSIT = 'DEPOSIT',
  /** A hryvnia top-up completed and was credited at its frozen rate. */
  FIAT_DEPOSIT = 'FIAT_DEPOSIT',
  /** Frozen against a new sale — the only kind that is always negative. */
  SALE_STAKE = 'SALE_STAKE',
  /** Unfrozen back onto the balance: a cancelled, failed or part-filled order. */
  SALE_REFUND = 'SALE_REFUND',
  /** Referral earnings moved from the referral pot onto the spendable balance. */
  REFERRAL_TRANSFER = 'REFERRAL_TRANSFER',
  /** An operator corrected the balance by hand. Signed either way. */
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
  /**
   * The balance brought forward from before this book existed.
   *
   * One line per user, written once by the backfill migration and by nothing
   * else: it is whatever the reconstructed history cannot account for, so that
   * the sum of a user's entries equals their balance from the first day the
   * book is real. Mostly referral transfers, which left no trace anywhere and
   * cannot be recovered, plus refunds on cancelled orders, which were never
   * written to the order.
   *
   * Never shown to the user. It is an artefact of when we started counting, not
   * something that happened to their money.
   */
  OPENING_BALANCE = 'OPENING_BALANCE',
}
