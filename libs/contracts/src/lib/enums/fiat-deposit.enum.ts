/**
 * A fiat top-up's life, from the moment a Transacto payout is reserved for one
 * Mini App user to the moment their USDT lands — or a person has to look at it.
 *
 * The user is paying somebody else's payout out of their own card: the hryvnia
 * leaves their bank and never touches ours, and what we hand back is USDT at
 * the rate frozen when they reserved. So these members describe *how far along
 * a real transfer is*, and the only one that moves a balance is
 * {@link COMPLETED}.
 */
export enum TmaFiatDepositStatus {
  /**
   * The payout is assigned to this user and nobody else can take it. The card
   * is on screen and the pay window is running; as far as we know no money has
   * moved yet.
   */
  RESERVED = 'RESERVED',
  /**
   * Transacto accepted at least one receipt, and the accepted receipts still
   * add up to less than the payout.
   *
   * An ordinary middle state rather than a fault: a large payout is normally
   * settled in several transfers, and Transacto closes it only once the whole
   * amount is covered. The balance stays untouched here — crediting per receipt
   * would pay out for money the payout does not yet consider received.
   */
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  /**
   * Transacto reports the payout as fully executed. The USDT is credited
   * exactly once, at the rate snapshotted on this document.
   */
  COMPLETED = 'COMPLETED',
  /**
   * The hold elapsed with no accepted receipt, so the payout went back to
   * Transacto's book and the user may reserve another.
   *
   * Safe to do automatically precisely because nothing was ever accepted
   * against it — compare {@link REVIEW}.
   */
  EXPIRED = 'EXPIRED',
  /**
   * The user gave the payout back before paying anything.
   *
   * The same ledger fact as {@link EXPIRED} — nothing was paid, the payout went
   * back to the book — and a separate member all the same, because an operator
   * reading a row needs to know whether a person decided this or a clock did.
   * Only offered while nothing has been accepted: releasing a payout somebody
   * has already paid into is never the user's to do.
   */
  CANCELLED = 'CANCELLED',
  /**
   * Money may have moved and no automatic answer is right.
   *
   * Reached when the hold runs out on a partially covered payout, or when
   * Transacto ends one in a way we cannot read. Deliberately *not* released
   * back to the book: handing away a payout a user has already paid into is the
   * one mistake here that costs them their own hryvnia, so it waits for an
   * operator instead.
   */
  REVIEW = 'REVIEW',
}

/** Where one uploaded receipt got to. */
export enum TmaFiatReceiptStatus {
  /**
   * The file is with Transacto's recognition and the verdict has not come back.
   * Normally about two seconds; the upstream job is polled, not awaited.
   */
  PARSING = 'PARSING',
  /** Transacto attached it to the payout. Its amount counts toward coverage. */
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/**
 * Why a receipt was refused — a key the Mini App renders in the user's
 * language, never a sentence.
 *
 * **Deliberately coarse, and honestly so.** Transacto's refusals have not been
 * catalogued: the only failing responses seen so far carry a free-text
 * `error_message` in mixed Russian and Ukrainian, with no stable code beside
 * it. Everything that is not a recognition failure or a timeout therefore
 * arrives as {@link NOT_ACCEPTED}, and the provider's own words go to the log
 * for an operator, not to the user. Adding members *for Transacto* means first
 * seeing the responses that justify them.
 *
 * The last four are ours and are decided before Transacto is told anything at
 * all — the state receipt service is asked first, and a receipt it will not
 * vouch for never becomes an upload. They are precise where the Transacto ones
 * are coarse for exactly that reason: we know why we refused.
 */
export enum TmaFiatReceiptRejection {
  /** Transacto could not read the file as a receipt at all. */
  PARSE_FAILED = 'PARSE_FAILED',
  /** It read the receipt and would not attach it to this payout. */
  NOT_ACCEPTED = 'NOT_ACCEPTED',
  /** Recognition never came back. The file may still be attached upstream. */
  TIMED_OUT = 'TIMED_OUT',
  /**
   * No receipt code could be read out of the file.
   *
   * Ours, not Transacto's, and the only one of these that is reached before
   * anything is sent upstream: without a code there is nothing to ask the state
   * service about, so the receipt stops here.
   */
  CODE_UNREADABLE = 'CODE_UNREADABLE',
  /**
   * The state receipt service does not know this code.
   *
   * A receipt whose code no bank ever issued is not a receipt, whatever the
   * file looks like — which is the whole reason the check happens before the
   * upload rather than after it.
   */
  UNVERIFIED = 'UNVERIFIED',
  /**
   * The payment is genuine and is not this payout's.
   *
   * The sum, the recipient card or the moment of payment disagrees with what
   * this top-up reserved. Kept apart from {@link UNVERIFIED} because the two
   * mean opposite things to an operator: one is a forged or mistyped code, the
   * other is a real transfer pointed at the wrong row — often somebody's own
   * earlier receipt, uploaded twice.
   */
  MISMATCHED = 'MISMATCHED',
  /**
   * The state service could not be reached, so nothing was proven either way.
   *
   * Not a refusal of the receipt. It exists so an operator can tell "we
   * refused this" from "we could not look", which are the same blank screen to
   * the user and completely different questions to whoever picks the row up.
   */
  VERIFIER_UNAVAILABLE = 'VERIFIER_UNAVAILABLE',
}

/**
 * The statuses in which a top-up can still be paid into.
 *
 * Here rather than in any one app because all three ask it and must not
 * disagree: the backend decides whether to accept a receipt, the Mini App
 * decides whether to show the card and the upload button, and the panel decides
 * whether an operator's menu applies. Three copies of this rule would drift on
 * the first status anybody added — and the copy that drifted would either
 * invite a transfer to a payout that is no longer ours, or refuse a receipt for
 * one that is.
 */
export const FIAT_DEPOSIT_PAYABLE_STATUSES: readonly TmaFiatDepositStatus[] = [
  TmaFiatDepositStatus.RESERVED,
  TmaFiatDepositStatus.PARTIALLY_PAID,
];

/**
 * The statuses in which the Transacto payout behind a top-up is still ours.
 *
 * Wider than {@link FIAT_DEPOSIT_PAYABLE_STATUSES} by exactly one member: a
 * top-up under review takes no more receipts, but its payout is deliberately
 * still held — releasing one somebody has already paid into is the mistake this
 * whole design exists to avoid. It is therefore also the set an operator can
 * still act on.
 */
export const FIAT_DEPOSIT_HELD_STATUSES: readonly TmaFiatDepositStatus[] = [
  ...FIAT_DEPOSIT_PAYABLE_STATUSES,
  TmaFiatDepositStatus.REVIEW,
];

export const isFiatDepositPayable = (status: TmaFiatDepositStatus): boolean =>
  FIAT_DEPOSIT_PAYABLE_STATUSES.includes(status);

export const isFiatDepositHeld = (status: TmaFiatDepositStatus): boolean =>
  FIAT_DEPOSIT_HELD_STATUSES.includes(status);

/**
 * How long a user's standing request for an amount lasts.
 *
 * The choice is theirs and it is a real one, because the two answers suit
 * opposite people. Somebody topping up once wants to hear about it and never
 * again; somebody who tops up daily wants to hear every time a sum they can
 * afford reaches the book. Guessing on their behalf would be wrong for half of
 * them, and the wrong half is the one that mutes the bot.
 *
 * Notification is per **amount newly on offer**, never per refresh: the book is
 * re-read every twenty seconds, and a sum sitting in it for an hour is one
 * arrival, not a hundred and eighty.
 */
export enum FiatDepositWatchMode {
  /**
   * Tell me once, then forget me.
   *
   * The request is deleted as the message is sent, so there is nothing left to
   * unsubscribe from — which is why messages in this mode carry no unsubscribe
   * button. Offering one would invite a tap that answers "already done".
   */
  ONCE = 'ONCE',
  /**
   * Tell me every time a new sum in this range appears.
   *
   * Lives until the user cancels it, from the bot or from the Mini App. It
   * survives a completed top-up on purpose: somebody who tops up repeatedly is
   * exactly who picks this, and clearing it on the first success would silently
   * turn it into {@link ONCE}.
   */
  ALWAYS = 'ALWAYS',
}
