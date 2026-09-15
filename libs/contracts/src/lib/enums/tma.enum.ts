export enum TrustLevel {
  NEWBIE = 'NEWBIE',
  EXPERIENCED = 'EXPERIENCED',
  PRO = 'PRO',
}

export enum TmaDepositStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  PAID_LATE = 'PAID_LATE',
}

export enum TmaSaleStatus {
  CREATED = 'CREATED',
  TERMINAL_READY = 'TERMINAL_READY',
  AWAITING_FIAT = 'AWAITING_FIAT',
  /**
   * The user asked to stop, and open orders are still outstanding.
   *
   * The terminal stops being offered to new payers but **stays in service**:
   * anyone already holding an order can still pay it, and we have to be able to
   * see that money arrive. A sale that stopped watching its jar here
   * would refund the whole stake while the user kept the hryvnia a late payer
   * sent — paying for the same money twice.
   *
   * Ends as {@link CANCELLED} once the last order settles, or as
   * {@link COMPLETED} if the jar fills before then.
   */
  CLOSING = 'CLOSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  /**
   * The order broke a rule of the scheme and was stopped, along with its
   * terminal. Distinct from {@link FAILED}, which means our own creation path
   * broke and is nobody's fault — a blocked order is something the user can be
   * told the reason for, via {@link SaleBlockReason}.
   *
   * The frozen USDT stays frozen: blocking is an anti-abuse action, and
   * releasing the stake automatically would make breaking the rules free.
   */
  BLOCKED = 'BLOCKED',
}

/**
 * Why a sale was blocked.
 *
 * A key, not a sentence: the Mini App renders `BLOCK_REASON.' + reason` in the
 * user's language, with the order's own figures as parameters.
 */
export enum SaleBlockReason {
  /**
   * The jar's target does not match what the order is for.
   *
   * The target has to equal the sold amount plus profit exactly, so that a
   * payment either fills the jar or does not. A jar with no target set counts
   * as a mismatch — an open-ended jar accepts anything.
   */
  GOAL_MISMATCH = 'GOAL_MISMATCH',
  /**
   * Three orders in a row expired against this terminal while the jar stayed
   * empty — the signature of a card number that does not belong to the jar the
   * link points at, so no payer can ever complete.
   */
  ORDERS_EXPIRED = 'ORDERS_EXPIRED',
  /**
   * An operator stopped it from the admin panel.
   *
   * The only member here that no rule produces — the other two are conclusions
   * the pipeline reaches on its own. It exists so a user whose order was
   * stopped by hand is told that, rather than being shown a rule they did not
   * break; the operator's own words go on the audit row, which is not something
   * the user sees.
   *
   * Like the others, the stake stays frozen: blocking is an anti-abuse action,
   * and an admin who means to give the money back cancels instead.
   */
  ADMIN_DECISION = 'ADMIN_DECISION',
  /**
   * The order was credited with more hryvnia than the jar can account for.
   *
   * `receivedAmount` and the terminal's baseline measure the same money by
   * different routes — one sums the orders that were credited, the other tracks
   * what the jar was actually observed to hold. They can only disagree if
   * something was credited twice, and an order that closes on the larger figure
   * commits a user's USDT for hryvnia nobody sent.
   *
   * It happened: an operator confirmed two orders in Transacto's panel, their
   * money stayed outside the baseline, the jar page caught up in one jump, and
   * fuzzy matching spent it again on two other orders. 606 UAH of USDT left for
   * payments that were never made, and both figures were sitting in the same
   * document at the moment it closed.
   *
   * Like the others the stake stays frozen: this is a discrepancy for a person
   * to resolve, not a rule the user broke.
   */
  LEDGER_MISMATCH = 'LEDGER_MISMATCH',
}

/**
 * What happens to the last stretch of an order that no payment can cover.
 *
 * Transacto will not route an order below a floor — ₴300 today — and a
 * terminal's turnover is capped at exactly the order's target. So once the jar
 * is within that floor of its goal, nothing more can arrive on its own: the gap
 * is unfillable by the pipeline that filled everything before it.
 *
 * The user picks which way that ends, at creation, and the choice is
 * snapshotted onto the order — changing the default later must not change how
 * an order already running settles.
 */
export enum SaleRemainderPolicy {
  /**
   * Wait for the jar to reach its goal however that happens — in practice, a
   * trader paying the tail in by hand.
   *
   * The default, and how every order behaved before the choice existed.
   */
  WAIT_FOR_TOP_UP = 'WAIT_FOR_TOP_UP',
  /**
   * Give the tail back as USDT and close the order successfully.
   *
   * The remainder is converted at the order's own snapshotted rate and returned
   * to the spendable balance, so the user is not left waiting on somebody else
   * to top up a jar by hand for the sake of a few hryvnia.
   */
  REFUND_TO_BALANCE = 'REFUND_TO_BALANCE',
}

/**
 * One step in a sale's execution, as the user watches it happen.
 *
 * These are keys, never sentences: the Mini App renders
 * `'SALE_EVENT.' + type` with the entry's own fields as parameters, so the
 * timeline reads in the user's language and the amount stays a number the
 * client can format. Adding a member means adding the matching translation in
 * all three dictionaries.
 */
export enum SaleEventType {
  /** The Transacto terminal was created and can accept money. */
  TERMINAL_CREATED = 'TERMINAL_CREATED',
  /** An order was placed against the terminal — money is on its way. */
  ORDER_RECEIVED = 'ORDER_RECEIVED',
  /** Money landed in the jar and was matched to an order. Carries `amount`. */
  PAYMENT_MATCHED = 'PAYMENT_MATCHED',
  /** An order on the terminal was cancelled upstream. */
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  /**
   * The user asked to stop while orders were still open. No new payers are
   * routed from here on; the order waits for the outstanding ones.
   */
  CLOSING_REQUESTED = 'CLOSING_REQUESTED',
  /** The full target was sold; frozen USDT is committed. */
  COMPLETED = 'COMPLETED',
  /** Terminal creation failed; the frozen USDT went back to the balance. */
  FAILED = 'FAILED',
  /**
   * The order was stopped for breaking a rule. Carries `amount` where the
   * reason has a figure attached — the jar's actual target, for a mismatch.
   */
  BLOCKED = 'BLOCKED',
  /**
   * The jar behind the order was closed, or the bank stopped serving it, so no
   * payment can ever arrive. Carries `amount`: the USDT cents refunded.
   *
   * Distinct from {@link STOPPED_BY_USER} because nobody stopped anything — the
   * order was ended for the user rather than by them, and a timeline saying
   * otherwise would be telling them they did something they did not.
   */
  JAR_CLOSED = 'JAR_CLOSED',
  /**
   * The user stopped the order early themselves. Carries `amount`: the USDT
   * cents refunded, which is the stake less whatever the jar had already taken.
   *
   * Distinct from {@link ORDER_CANCELLED}, which is one *upstream* order being
   * cancelled while the sale carries on.
   */
  STOPPED_BY_USER = 'STOPPED_BY_USER',
  /**
   * The unfillable tail was returned to the balance and the order closed.
   *
   * Only ever on an order created with
   * {@link SaleRemainderPolicy.REFUND_TO_BALANCE}, and always
   * immediately before {@link COMPLETED} — the refund is *how* that order
   * completed, not an alternative to completing.
   *
   * Carries `amount` in **USDT cents**, like {@link STOPPED_BY_USER} and unlike
   * the fiat events: what the user gets back is USDT, and the hryvnia figure it
   * was converted from is not a number they act on.
   */
  REMAINDER_REFUNDED = 'REMAINDER_REFUNDED',
  /**
   * An operator lifted a block and put the order back to work.
   *
   * Its own member rather than reusing {@link TERMINAL_CREATED}, which would be
   * very nearly true and therefore worse: the terminal *is* back, but a
   * timeline saying it was created hides that the order was blocked and then
   * un-blocked by a person. The stake never moved, so this carries no amount.
   */
  RESUMED_BY_ADMIN = 'RESUMED_BY_ADMIN',
  /**
   * An operator lifted a block and ended the order, returning the stake.
   *
   * Distinct from {@link STOPPED_BY_USER} for the reason {@link JAR_CLOSED} is:
   * nobody stopped anything — the order was ended *for* the user rather than by
   * them, and a timeline saying otherwise tells them they did something they
   * did not. Carries `amount` in USDT cents, the figure actually refunded,
   * which an operator may have set by hand.
   */
  RELEASED_BY_ADMIN = 'RELEASED_BY_ADMIN',
}
