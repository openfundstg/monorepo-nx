export enum OrderStatus {
  PENDING = 'PENDING',
  EXECUTED = 'EXECUTED',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  APPEAL = 'APPEAL',
}

/**
 * Why an order was settled — and, because it is rendered, *who* settled it.
 *
 * This is not bookkeeping colour. Every member is shown to somebody: a trader
 * sees it on terminal history, a Mini App user sees it on their sale. Recording
 * an automatic match as {@link ADMIN_PANEL} once told users a machine's decision
 * was a human's for as long as it went unnoticed, which is why a new settlement
 * path gets a new member here rather than borrowing the nearest one.
 */
export enum OrderExecutionReason {
  FULL_MATCH = 'FULL_MATCH',
  FUZZY_MATCH = 'FUZZY_MATCH',
  EXTENSION = 'EXTENSION',
  ADMIN_PANEL = 'ADMIN_PANEL',
  /**
   * The seller of a card sale said the money reached their card.
   *
   * No balance was observed and nothing was matched — this is testimony, and it
   * is accepted because it is against the teller's own interest. Distinct from
   * {@link ADMIN_PANEL} in the way that matters to the person reading it: an
   * operator did not look at anything.
   */
  USER_CONFIRMED = 'USER_CONFIRMED',
  /**
   * A bank statement showed the credit the seller had denied receiving.
   *
   * The order is settled on the document rather than on anybody's word. Kept
   * apart from {@link USER_CONFIRMED} because the two describe opposite
   * situations — one is a seller confirming, the other is a seller being
   * contradicted — and a single member covering both would hide every case
   * worth looking at.
   */
  STATEMENT_PROVEN = 'STATEMENT_PROVEN',
}
