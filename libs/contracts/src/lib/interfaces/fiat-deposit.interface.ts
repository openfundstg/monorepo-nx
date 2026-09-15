import {
  FiatDepositWatchMode,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus,
} from '../enums/fiat-deposit.enum.js';

/**
 * One amount a user may reserve, as offered on the top-up screen.
 *
 * Only the amount is offered. The card behind it belongs to a payout that
 * anybody may still take, and showing a stranger's card number to a user who
 * has not committed to paying it would hand out payment credentials for free —
 * the recipient card appears on {@link TmaFiatDeposit} once the payout is
 * theirs and not before.
 */
export interface FiatDepositAmountOption {
  /** UAH kopecks — the exact figure the user transfers. */
  amountUah: number;
  /** USDT cents this converts to at {@link FiatDepositOptionsResponse.exchangeRate}. */
  cryptoCents: number;
}

export interface FiatDepositOptionsResponse {
  /**
   * Distinct amounts currently free in Transacto's book, cheapest first.
   *
   * A snapshot, not a promise: a payout may be taken by another trader between
   * this response and the reservation, which is what
   * `ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE` reports.
   */
  options: FiatDepositAmountOption[];
  /**
   * Kopecks per 1 USDT for this product: the market rate less
   * `BUY_DISCOUNT_PERCENT`, which is what {@link options} were
   * priced at and what a reservation freezes.
   *
   * The same number `GET /api/tma/rates` reports as `fiatDeposit`. It is
   * repeated here because a quote must return with the amounts it priced —
   * reading it from the polled copy instead would let the list and the rate
   * above it come from two different reads.
   */
  exchangeRate: number;
  /**
   * The largest amount this user is offered, in UAH kopecks, or `null` when
   * nothing caps them.
   *
   * A ceiling only while the account has never had a deposit credited — by any
   * method, crypto or hryvnia. One settled top-up lifts it for good; turnover
   * has nothing to do with it, and neither does the trust level.
   *
   * Carried so the screen can say *why* the list stops where it does. Without
   * it a new user sees a short list on a busy night and a short list on a
   * capped account as the same thing, and the second has an answer they can act
   * on.
   */
  maxAmountUah: number | null;
  /** Minutes to pay once an amount is reserved, so the client can run the timer. */
  payWindowMinutes: number;
  /**
   * Whether the offer above is a reading of Transacto's book at all.
   *
   * `false` says the panel could not be reached, and it exists because the
   * alternative is a lie the screen cannot detect: a stale snapshot is served
   * as `options: []`, which renders identically to a book that genuinely has
   * nothing in it. One of those is "come back in a minute", the other is "this
   * is our fault", and a user shown the first while the second is true is being
   * told the product is quiet when it is broken.
   *
   * Never a reason to hide {@link watch}: a user who cannot see any amounts is
   * precisely the one who should be offered the chance to be told when one
   * appears.
   */
  bookAvailable: boolean;
  /**
   * This user's standing request to be told when a suitable sum appears, or
   * `null`.
   *
   * Carried on the options response rather than fetched separately because this
   * screen re-reads itself every twenty seconds and is where the request is
   * made: a request created here and then not echoed by the next poll would
   * flicker back to "not subscribed" under the user's eyes. The settings screen,
   * which polls nothing, reads it from `GET /tma/fiat-deposits/watch` instead.
   */
  watch: FiatDepositWatch | null;
  /**
   * The top-up this user already holds, or `null`.
   *
   * One at a time: a second reservation would put two of somebody else's
   * payouts on one person's card at once. The client uses this to send the user
   * back to the top-up they left rather than offering a list it will refuse.
   */
  activeDepositId: string | null;
}

export interface CreateFiatDepositReq {
  /** One of the offered {@link FiatDepositAmountOption.amountUah} values, in kopecks. */
  amountUah: number;
}

export interface FiatDepositReceipt {
  id: string;
  status: TmaFiatReceiptStatus;
  rejection: TmaFiatReceiptRejection | null;
  /**
   * What Transacto read off the receipt, in UAH kopecks — `null` until it has
   * been accepted.
   *
   * Theirs rather than ours on purpose: coverage is counted in the figures the
   * counterparty recognised, so a receipt we read differently cannot quietly
   * complete a payout they still consider open.
   */
  amountUah: number | null;
  uploadedAt: string;
}

export interface TmaFiatDeposit {
  id: string;
  status: TmaFiatDepositStatus;
  /** The payout's full amount, in UAH kopecks. */
  amountUah: number;
  /** USDT cents credited on completion, frozen at reservation. */
  cryptoCents: number;
  /** Kopecks per 1 USDT, snapshotted when the payout was reserved. */
  exchangeRate: number;
  /**
   * The card to transfer to, digits only — `null` once the top-up is no longer
   * payable, so a closed one cannot be paid into by someone re-reading an old
   * screen.
   */
  recipientCard: string | null;
  /** Accepted receipts so far, in UAH kopecks. Equals {@link amountUah} at completion. */
  coveredUah: number;
  payDeadlineAt: string;
  receipts: FiatDepositReceipt[];
  createdAt: string;
  completedAt: string | null;
}

/** Payload of {@link TmaWsEventNames.FIAT_DEPOSIT_STATUS_CHANGED}. */
export interface FiatDepositStatusEvent {
  depositId: string;
  status: TmaFiatDepositStatus;
  /** Carried with the status so a progress bar updates without a refetch. */
  coveredUah: number;
}

/**
 * A user's standing request to be told when a sum they can use reaches the
 * book.
 *
 * The book is other people's payouts, so the product cannot promise any
 * particular amount will ever appear — which is exactly why this exists. A user
 * who wants ₴7 000 on a night when the book holds ₴300 and ₴42 000 has nothing
 * to do but re-open the screen, and the honest answer to that is to take their
 * range and call them.
 *
 * **One per user, replaced rather than added to.** A list of ranges would need
 * managing, and managing it is a screen; a single range is a sentence the user
 * can read back in one line and cancel with one tap. Asking again simply
 * overwrites.
 *
 * Both bounds are inclusive, and a range of one amount is written by setting
 * them equal — which is what somebody who needs exactly ₴5 000 will do.
 */
export interface FiatDepositWatch {
  /** Smallest amount worth waking this user for, in UAH kopecks. Inclusive. */
  minAmountUah: number;
  /** Largest, in UAH kopecks. Inclusive, and never below {@link minAmountUah}. */
  maxAmountUah: number;
  mode: FiatDepositWatchMode;
  /** ISO. What the screen shows as "asked at", and what the panel sorts on. */
  createdAt: string;
  /**
   * ISO of the last message sent for this request, or `null` when none has
   * been.
   *
   * Only ever populated in {@link FiatDepositWatchMode.ALWAYS}: a `ONCE`
   * request is deleted by the message that satisfies it, so there is no
   * document left to stamp.
   */
  lastNotifiedAt: string | null;
}

/**
 * Creating or replacing {@link FiatDepositWatch}.
 *
 * A `PUT` rather than a `POST` precisely because there is one per user: asking
 * twice must leave one request, not two, and the client should not have to know
 * whether it is creating or amending.
 */
export interface SaveFiatDepositWatchReq {
  /** UAH kopecks. Inclusive. */
  minAmountUah: number;
  /** UAH kopecks. Inclusive, and must not be below {@link minAmountUah}. */
  maxAmountUah: number;
  mode: FiatDepositWatchMode;
}
