/**
 * Enums owned by the admin panel.
 *
 * Every member travels over the wire — as a filter value, an action name or a
 * row in the audit log — so it lives here rather than in either app. The audit
 * enums in particular are persisted, so renaming a member rewrites history:
 * add, never repurpose.
 */

/** Sort direction on every paginated admin list. */
export enum AdminSortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Which way a manual balance correction moves money.
 *
 * Deliberately two members rather than a signed amount. A negative number is a
 * typo away from a credit, and the audit row would record the typo rather than
 * the intent; naming the direction makes both the request and the log
 * unambiguous.
 */
export enum AdminBalanceOperation {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

/**
 * Which pot a manual correction touches.
 *
 * The spendable balance and the referral pot are separate by design — referral
 * money can only ever be moved across, never spent directly — so a correction
 * has to say which one it means.
 */
export enum AdminBalanceTarget {
  BALANCE = 'BALANCE',
  REFERRAL_BALANCE = 'REFERRAL_BALANCE',
}

/**
 * An intervention an admin can make on a running sale.
 *
 * These are the operations that already exist inside the sale services,
 * exposed to an operator rather than reimplemented — an admin cancelling an
 * order must settle exactly the way the user cancelling it would.
 */
export enum AdminSaleAction {
  /** Stop the order and refund the untouched part of the stake. */
  CANCEL = 'CANCEL',
  /** Stop the order for rule-breaking. The stake stays frozen. */
  BLOCK = 'BLOCK',
  /** Settle the order as done, committing the frozen stake. */
  COMPLETE = 'COMPLETE',
  /**
   * Put a blocked order back to work.
   *
   * The terminal comes back up on Transacto and the order returns to
   * `AWAITING_FIAT` with its stake still frozen — nothing about the money
   * changes, because nothing about the order has ended.
   *
   * Possible only because blocking never deletes the credential: it stands the
   * terminal down, which is reversible. **If the condition that caused the
   * block still holds** — a jar goal that does not match, above all — the
   * scraper blocks it again within a minute, which is the correct outcome
   * rather than a bug.
   */
  RESUME = 'RESUME',
  /**
   * End a blocked order and give the stake back.
   *
   * The other half of a review: the block was wrong, so the order closes as
   * cancelled and the money returns. Separate from {@link CANCEL}, which is for
   * an order still running — this is the only way out of `BLOCKED`, whose stake
   * would otherwise stay frozen for good.
   */
  RELEASE = 'RELEASE',
  /**
   * Declare a finished sale's jar closed, releasing the slot it still holds.
   *
   * The escape hatch for the rule that a sale keeps its slot until the bank
   * says the jar is gone. That rule is enforced by asking the bank, and asking
   * can fail in ways no user can fix: the case page still answers though the
   * jar is closed, the provider changes the shape it answers in, or the
   * terminal fell out of the scrape loop and the sweep cannot reach it. Without
   * this, each of those is a user locked out of the product for good with
   * nothing support can do about it.
   *
   * It sets `jarClosedAt` and nothing else — no money moves, no status changes.
   * **It is an operator overriding a safety rule**, so the point of it is to be
   * recorded rather than to be convenient: the jar may genuinely still be open,
   * and money landing in it afterwards will still match nothing.
   */
  RELEASE_JAR = 'RELEASE_JAR',
}

/** What an audit row is about. */
/**
 * What an operator can do to a fiat top-up.
 *
 * Only two, and both are interventions the automatic path deliberately refuses
 * to make on its own — see `TmaFiatDepositStatus.REVIEW`. Everything else about
 * a top-up settles from Transacto's own answer.
 */
export enum AdminFiatDepositAction {
  /**
   * Credit the user by hand.
   *
   * For a payout Transacto executed in a way the reconciler could not read —
   * the money reached the recipient and the user is owed their USDT.
   */
  COMPLETE = 'COMPLETE',
  /**
   * Give the payout back and close the top-up unpaid.
   *
   * The judgement the sweep refuses to make once anything has been paid in: an
   * operator has established that nothing landed, or that what did is being
   * settled another way.
   */
  RELEASE = 'RELEASE',
}

export enum AdminAuditTargetType {
  TMA_USER = 'TMA_USER',
  SALE = 'SALE',
  ALERT = 'ALERT',
  DEPOSIT = 'DEPOSIT',
  TERMINAL = 'TERMINAL',
  TRADER = 'TRADER',
  SESSION = 'SESSION',
  FIAT_DEPOSIT = 'FIAT_DEPOSIT',
}

/**
 * Every state-changing thing an admin can do.
 *
 * Persisted on each audit row, so the panel renders `'AUDIT.' + action` and the
 * database never stores a rendered sentence — the same rule the alerts and
 * sale timelines follow.
 */
export enum AdminAuditAction {
  LOGIN = 'LOGIN',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  USER_ACTIVATED = 'USER_ACTIVATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_BALANCE_ADJUSTED = 'USER_BALANCE_ADJUSTED',
  USER_DEMO_ENABLED = 'USER_DEMO_ENABLED',
  USER_DEMO_DISABLED = 'USER_DEMO_DISABLED',
  SALE_CANCELLED = 'SALE_CANCELLED',
  SALE_BLOCKED = 'SALE_BLOCKED',
  SALE_COMPLETED = 'SALE_COMPLETED',
  SALE_RESUMED = 'SALE_RESUMED',
  SALE_RELEASED = 'SALE_RELEASED',
  SALE_JAR_RELEASED = 'SALE_JAR_RELEASED',
  ALERT_RESOLVED = 'ALERT_RESOLVED',
  ALERT_DELETED = 'ALERT_DELETED',
  TERMINAL_ENABLED = 'TERMINAL_ENABLED',
  TERMINAL_DISABLED = 'TERMINAL_DISABLED',
  TERMINAL_ORDERS_RESUMED = 'TERMINAL_ORDERS_RESUMED',
  TERMINAL_ORDERS_PAUSED = 'TERMINAL_ORDERS_PAUSED',
  TRADER_ACTIVATED = 'TRADER_ACTIVATED',
  TRADER_DEACTIVATED = 'TRADER_DEACTIVATED',
  FIAT_DEPOSIT_COMPLETED = 'FIAT_DEPOSIT_COMPLETED',
  FIAT_DEPOSIT_RELEASED = 'FIAT_DEPOSIT_RELEASED',
}

/**
 * Which slice of the sales book a screen is asking for.
 *
 * One parameter rather than a `method` and a `disputed` flag, because the three
 * are what an operator actually picks between and most combinations of two
 * independent flags mean nothing. {@link DISPUTED} is not a method at all — it
 * is the queue of card orders waiting on a person, which is the errand the
 * panel used to keep on a screen of its own.
 *
 * **There is no `ALL` member, deliberately.** The whole book is the absence of
 * this parameter, which is the same thing the other two filtered lists mean by
 * absence — and two ways to say "no filter" is how one of them ends up
 * unhandled.
 */
export enum AdminSaleFilter {
  /** Into the seller's bank jar, watched by the scraper. */
  JAR = 'JAR',
  /** Straight to the seller's card, confirmed by them. */
  CARD = 'CARD',
  /** Card sales whose order was denied or proven unpaid. */
  DISPUTED = 'DISPUTED',
}

/**
 * Which of the two ways money comes in a row describes.
 *
 * The panel lists both in one book because an operator answering "has this
 * person topped up" does not care which rail it came over — and the ceiling on
 * a new account is lifted by one settled deposit *by either method*, so a
 * screen that shows only one of them cannot explain the rule.
 */
export enum AdminDepositKind {
  /** USDT sent to an address, verified on chain. */
  CRYPTO = 'CRYPTO',
  /** Hryvnia paid to a Transacto payout's card, proven by a receipt. */
  FIAT = 'FIAT',
}

/**
 * What a document in the archive is.
 *
 * The two are not the same evidence and must never read as one: a statement is
 * somebody's transaction history, uploaded to disprove one payment, and it is
 * judged here; a receipt is proof of one transfer, judged by its bank's
 * signature and then by Transacto's own recognition.
 */
export enum AdminDocumentKind {
  /** A bank statement answering a disputed card order. */
  SALE_STATEMENT = 'SALE_STATEMENT',
  /** A payment receipt sent against a fiat top-up. */
  FIAT_RECEIPT = 'FIAT_RECEIPT',
}

/** How the panel asks for a document's bytes. */
export enum AdminDocumentDisposition {
  /** Rendered in a browser tab, for a glance at what a document says. */
  INLINE = 'inline',
  /** Saved, for filing against an appeal. */
  ATTACHMENT = 'attachment',
}

/**
 * Which of a row's two figures an amount range applies to.
 *
 * Every row in both books carries one of each — a sale has a hryvnia target and
 * a USDT stake, a deposit has a hryvnia amount and the USDT it credits — and
 * "over ₴5 000" and "staking over 100 USDT" are different questions about the
 * same row. A single amount filter would have to answer one of them and be
 * silently wrong about the other.
 */
export enum AdminAmountCurrency {
  /** Kopecks, on the wire. */
  UAH = 'UAH',
  /** Cents, on the wire. */
  USDT = 'USDT',
}
