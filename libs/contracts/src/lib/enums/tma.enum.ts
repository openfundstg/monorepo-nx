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

/**
 * Where a sale delivers the hryvnia, and therefore what proves it arrived.
 *
 * The two variants differ in one thing that changes everything downstream:
 * **who says the money landed.**
 *
 * - {@link JAR} is proven by the bank. The user's jar is registered as the
 *   Transacto credential, `bank-scraper` reads its balance, and the matcher
 *   settles an order against an observed increase. Two independent records of
 *   the same hryvnia exist — `receivedAmount` and the terminal's baseline — and
 *   {@link SaleBlockReason.LEDGER_MISMATCH} refuses a completion where they
 *   disagree.
 * - {@link CARD} is proven by the user. Money goes straight to their card,
 *   nothing scrapes anything, and the only record is the seller pressing a
 *   button. The ledger guard is not merely switched off here — it is
 *   **unbuildable**, because there is no second record to compare against.
 *
 * What replaces it is arithmetic, not observation: a card sale's credential is
 * capped at one open order, `SALE_CARD_MAX_ORDERS` transactions in total,
 * and a minimum order of `target / SALE_CARD_MAX_ORDERS`. Those three numbers
 * are the blast radius of a single unnoticed mistake, which is why they are a
 * contract and not a tuning knob.
 */
export enum SaleMethod {
  /** Into the user's bank jar, watched by the scraper. */
  JAR = 'JAR',
  /** Straight to the user's card, confirmed by the user. */
  CARD = 'CARD',
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
  /**
   * A {@link SaleMethod.CARD} order ran out of time without the seller saying
   * whether the money arrived, and the statement they were asked for did not
   * settle it either.
   *
   * Only reachable on the card variant, where a confirmation is the only record
   * of the hryvnia. Routing was already stopped when the order was disputed;
   * this is the sale itself coming to rest so a person can look at it.
   *
   * Like the others the stake stays frozen — the seller may still be owed it,
   * and they may equally be holding both halves.
   */
  ORDER_UNCONFIRMED = 'ORDER_UNCONFIRMED',
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
 * Where one Transacto order of a {@link SaleMethod.CARD} sale stands.
 *
 * The whole variant turns on an asymmetry worth stating once: **a seller has a
 * motive to lie in exactly one direction.** Saying "it did not arrive" when it
 * did leaves them holding both the hryvnia and the USDT; saying "it arrived"
 * when it did not costs them their own stake. So a confirmation is taken at
 * face value — it is testimony against interest — and a denial is never taken
 * at all without a document behind it.
 *
 * That is why {@link CONFIRMED} is reached by a button and {@link PROVEN_UNPAID}
 * is not.
 */
export enum SaleCardOrderState {
  /**
   * A payer was routed here and the seller has not answered yet.
   *
   * Both surfaces that can answer — the sale's page and the bot's inline
   * keyboard — call the same method, so whichever arrives second is a no-op
   * rather than a second confirmation.
   */
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  /** The seller said the money landed, and the order was executed upstream. */
  CONFIRMED = 'CONFIRMED',
  /**
   * The seller said it did not land, or said nothing until the deadline passed.
   *
   * Routing to the terminal stops the moment this is reached — not as a
   * punishment, but because more money must not arrive somewhere a dispute is
   * already open. The way out is a confirmation or a statement.
   */
  DISPUTED = 'DISPUTED',
  /**
   * A statement showed the money *did* arrive, contradicting the denial.
   *
   * The order is executed on the document's word rather than the seller's, with
   * {@link OrderExecutionReason.STATEMENT_PROVEN} recording which it was. The
   * contradiction itself is a fact about the seller, and it goes to an operator.
   */
  PROVEN_PAID = 'PROVEN_PAID',
  /**
   * A statement covering the whole window showed no such credit.
   *
   * Nothing is executed. The order rests here with its statement attached and
   * waits for an operator, who settles the dispute in Transacto's own panel —
   * this codebase deliberately does not close appeals.
   */
  PROVEN_UNPAID = 'PROVEN_UNPAID',
}

/**
 * How much the recipient's name on a sale has been proven.
 *
 * Two states, not a list of sources, because only one distinction matters: has
 * a bank document replaced what was assembled at creation, or not.
 *
 * At creation the name comes from whichever source was available — the bank
 * behind a jar link, the seller's Telegram profile, or the seller typing it for
 * a card sale — and none of those is checked against the account the money
 * actually lands on. A statement is.
 *
 * The rewrite is worth recording rather than doing quietly. If the name on the
 * statement is not the name that was there, money has already gone to a card
 * whose holder was described wrongly, and that is an operator's question rather
 * than a field update.
 */
export enum SaleReceiverNameSource {
  /**
   * Whatever was available when the sale was created, and unchecked since.
   *
   * The starting value for every sale of either variant.
   */
  DECLARED = 'DECLARED',
  /** Replaced by a signed bank statement, which outranks all of the above. */
  STATEMENT = 'STATEMENT',
}

/** How far one uploaded statement has got. */
export enum SaleStatementStatus {
  /** Stored, signature not checked yet. */
  UPLOADED = 'UPLOADED',
  /** Signature held; the document is being read. */
  PARSING = 'PARSING',
  /** Read, and its verdict applied to the order it answers. */
  ACCEPTED = 'ACCEPTED',
  /** Refused — see {@link SaleStatementRejection}. */
  REJECTED = 'REJECTED',
}

/**
 * Why a statement proved nothing.
 *
 * **A statement is asked to prove a negative**, which a receipt never is, and
 * that makes every one of these a refusal rather than a verdict. A document
 * that does not cover the order's window, or that has a row nobody could read,
 * is not evidence of absence — reading it as "no credit found" is the failure
 * mode this enum exists to make impossible.
 *
 * Keys, not sentences: the Mini App renders `'SALE_STATEMENT.' + rejection`.
 */
export enum SaleStatementRejection {
  /**
   * The file carries no valid signature, so it is a file and not a bank
   * document. A screenshot or a re-printed PDF lands here.
   */
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  /**
   * The signature is valid and the signer is not the bank.
   *
   * A qualified certificate can be bought by anybody, so a forger signs their
   * own invented statement and the service confirms — truthfully — that the
   * signature holds. Without this check the whole path is a forgery laundry.
   */
  NOT_A_BANK_SIGNER = 'NOT_A_BANK_SIGNER',
  /**
   * The document's layout could not be read in full.
   *
   * Includes a table with rows that parsed and rows that did not: a partially
   * read statement is not a shorter statement, it is an unknown one.
   */
  UNREADABLE = 'UNREADABLE',
  /** Its period does not contain the whole window the order was open for. */
  PERIOD_TOO_SHORT = 'PERIOD_TOO_SHORT',
  /** It is for a different card or account than the sale pays out to. */
  WRONG_ACCOUNT = 'WRONG_ACCOUNT',
  /**
   * It is for the right account and the right window, and it shows the credit
   * the seller denied receiving.
   *
   * The one member that is not a defect in the document — the document is fine,
   * and it disagrees with the person who sent it.
   */
  CONTRADICTED = 'CONTRADICTED',
  /**
   * The bank does not know this document.
   *
   * Only reachable where a bank is asked about a statement by its own number
   * rather than about the bytes — PrivatBank today. It is the strongest refusal
   * available: not "this looks wrong" but "the institution that would have
   * issued it says it did not".
   */
  NOT_REGISTERED = 'NOT_REGISTERED',
  /**
   * Nothing could be established, because the check itself could not run.
   *
   * **Not the sender's fault, and it must never read as one.** The certification
   * service was unreachable, the bank's lookup timed out, the text extractor was
   * down. The statement is kept and an operator decides; telling somebody their
   * document was refused because our own dependency was unwell is the one
   * message this enum must not be able to produce.
   */
  VERIFIER_UNAVAILABLE = 'VERIFIER_UNAVAILABLE',
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
  /**
   * The seller confirmed one {@link SaleMethod.CARD} order's money reached
   * their card. Carries `amount` in kopecks and the `orderId` it answers.
   *
   * Deliberately not {@link PAYMENT_MATCHED}, which would be very nearly true
   * and therefore worse: matching is something the scraper does against an
   * observed balance, and saying so on a card sale would tell the user a machine
   * checked when a person asserted. The distinction is the same one
   * {@link OrderExecutionReason} draws, and it is user-visible on both.
   */
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  /**
   * One order was denied by the seller, or ran out of time unanswered. Carries
   * `amount` and `orderId`. Routing stopped when this was written.
   */
  ORDER_DISPUTED = 'ORDER_DISPUTED',
  /** A statement was uploaded against a disputed order. Carries `orderId`. */
  STATEMENT_SUBMITTED = 'STATEMENT_SUBMITTED',
  /**
   * A statement was refused and the dispute is where it was. Carries `orderId`;
   * the reason is on the statement, because a timeline entry has no room for one
   * and the upload card is where the user is looking.
   */
  STATEMENT_REJECTED = 'STATEMENT_REJECTED',
}
