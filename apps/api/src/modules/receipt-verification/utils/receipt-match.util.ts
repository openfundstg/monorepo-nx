import { UAH_CURRENCY_CODE } from 'src/shared/constants'
import { matchesMaskedCard } from '@transacto/contracts'
import { isAccountNotCard, readRecipientCard } from 'src/shared/utils'
import { ReceiptMismatch } from 'src/modules/receipt-verification/enums'
import type {
  AttestedReceipt,
  ReceiptExpectation
} from 'src/modules/receipt-verification/interfaces'

/** ISO 4217 numeric for the hryvnia. Every payout in this product is in it. */

/**
 * Whether an attested receipt is the payment this payout is waiting for.
 *
 * The state service answers a narrower question than the one that matters. It
 * says "this code names a real payment of ₴X to card Y at time T" — and a real
 * payment is not automatically *this* payment. Every fraud left after the code
 * is verified is the same one: a genuine receipt for something else. Somebody's
 * own transfer from last week, a transfer to their own card, a transfer of a
 * smaller sum. So the three facts the service returns are each pinned to
 * something the payout fixed before the user was shown a card.
 *
 * Returns every disagreement rather than the first, because an operator reading
 * a refused receipt wants to know whether one thing was off or nothing matched
 * at all — the first is a mistake, the second is somebody trying it on.
 */
export const matchReceipt = (
  receipt: AttestedReceipt,
  expectation: ReceiptExpectation
): readonly ReceiptMismatch[] => [
  ...amountMismatch(receipt, expectation),
  ...currencyMismatch(receipt),
  ...recipientMismatch(receipt, expectation),
  ...timingMismatch(receipt, expectation)
]

/**
 * How much more than the payout a receipt may state and still be it.
 *
 * **A transfer fee is the payer's, and some banks put it inside the amount.** A
 * monobank receipt for a ₴1 470 top-up read `Сума (грн) 1 477.39` — the ₴7.39
 * the payer chose to cover for the recipient — and ₴1 470 appeared nowhere on
 * the document. Refusing that sent a correct payment to an operator.
 *
 * Five per cent is far wider than any fee observed — the one above is 0.5% —
 * and it is deliberately generous, because what it buys is not accuracy but
 * fewer people stuck in a queue. It can afford to be generous because this
 * check is a gate on *forwarding*, not on money: a receipt that passes here
 * still has to satisfy Transacto's own recognition before anything is credited.
 */
const FEE_TOLERANCE_PERCENT = 5

/**
 * The sum must be the outstanding one, or that plus a fee the payer covered.
 *
 * **Upward only, and that asymmetry is the whole of the rule.** A receipt for
 * *less* is an underpayment, which is what this check exists to catch, and it
 * stays a refusal at one kopeck below. A receipt for more is somebody paying a
 * transfer fee out of their own pocket, which costs this product nothing — and
 * the credit is the payout's amount either way, never the receipt's, so the
 * overage stays the payer's and is never turned into balance.
 *
 * Still not "at most", which would accept a part-payment the panel has no way
 * to reconcile against a payout it will only release in full.
 */
const amountMismatch = (
  receipt: AttestedReceipt,
  expectation: ReceiptExpectation
): readonly ReceiptMismatch[] => {
  const overpaid = receipt.amountUah - expectation.amountUah

  if (overpaid < 0) return [ReceiptMismatch.AMOUNT]

  return overpaid <= feeAllowance(expectation.amountUah) ? [] : [ReceiptMismatch.AMOUNT]
}

/**
 * The largest fee this build will absorb, in kopecks.
 *
 * Floored rather than rounded: the boundary belongs on the passing side, so a
 * receipt exactly at the limit is accepted and one a kopeck past it is not.
 */
export const feeAllowance = (expectedKopecks: number): number =>
  Math.floor((expectedKopecks * FEE_TOLERANCE_PERCENT) / 100)

/**
 * Hryvnia, and checked despite every payout being in hryvnia.
 *
 * Without it the amount comparison is a comparison of two bare numbers, and
 * ₴3 600 would be settled by $36.00 — the receipt would be real, the code would
 * verify, and the figures would agree.
 */
const currencyMismatch = (receipt: AttestedReceipt): readonly ReceiptMismatch[] =>
  receipt.currencyCode === UAH_CURRENCY_CODE ? [] : [ReceiptMismatch.CURRENCY]

/**
 * The money must have gone to the card this payout named.
 *
 * The strongest of the checks and the one worth being strict for: a receipt
 * whose recipient cannot be read has not been checked, and is refused rather
 * than waved through. That is also the shape a change in their rendering would
 * take, which is why it has a mismatch of its own instead of sharing
 * {@link ReceiptMismatch.RECIPIENT} — one is a wrong card, the other is a
 * parser that needs looking at.
 */
const recipientMismatch = (
  receipt: AttestedReceipt,
  expectation: ReceiptExpectation
): readonly ReceiptMismatch[] => {
  // Asked first, because an account and an unreadable rendering are opposite
  // findings that would otherwise share an outcome: one is a receipt nobody can
  // match, the other is a parser somebody should look at.
  if (isAccountNotCard(receipt.recipient)) return [ReceiptMismatch.RECIPIENT_NOT_A_CARD]

  const card = readRecipientCard(receipt.recipient)
  if (card === null) return [ReceiptMismatch.RECIPIENT_UNREADABLE]

  return matchesMaskedCard(expectation.recipientCard, card) ? [] : [ReceiptMismatch.RECIPIENT]
}

/**
 * How precisely a receipt states when the money moved: to the minute.
 *
 * Not an allowance and not a tolerance — it is the resolution of one side of
 * the comparison. Both banks print `HH:mm` and nothing finer, and both parsers
 * read exactly that, so `paidAt` is always on a whole minute by construction.
 * A payment made at 03:02:35 is stated as 03:02:00 and there is no document
 * anywhere that says otherwise.
 */
const RECEIPT_TIME_RESOLUTION_MS = 60 * 1000

/**
 * The reservation, expressed at the resolution the receipt is readable at.
 *
 * Flooring the *bound*, never shifting the receipt: what is uncertain here is
 * which second inside its minute the payment happened, so the comparison is
 * made at the resolution both sides actually have.
 */
const atReceiptResolution = (moment: Date): number =>
  Math.floor(moment.getTime() / RECEIPT_TIME_RESOLUTION_MS) * RECEIPT_TIME_RESOLUTION_MS

/**
 * The transfer must have happened inside this top-up's own window.
 *
 * **The early bound is the reservation's own minute, not its exact instant**,
 * and the difference is not a grace anybody chose — it is the two sides being
 * compared at the same resolution. A receipt states the minute; a reservation
 * knows the second. Comparing them raw refuses every payment made in the
 * remainder of the minute the payout was reserved in: reserve at 03:02:22, pay
 * at 03:02:35, and the document says 03:02:00, which is thirteen seconds *after*
 * the reservation and twenty-two seconds *before* it depending on which number
 * you read.
 *
 * It refused people for paying quickly, which is the opposite of what anybody
 * wanted: with a reservation at second N, every payment in the following
 * `60 − N` seconds was called a reuse. One such receipt — genuine, signed,
 * exact to the kopeck, for the right card — was refused as PAID_TOO_EARLY, went
 * to an operator, and the user was credited three hours later by hand.
 *
 * **The reuse this check exists to catch is untouched.** An older payment is
 * older by minutes at the very least, and every one of those minutes still
 * fails. What is now accepted is a receipt naming the same minute the payout
 * was reserved in — a window no earlier payment can be inside.
 *
 * **The late bound stays exact**, and flooring it would introduce this bug's
 * mirror image: a payment truly made at 03:17:10 states 03:17:00, so a deadline
 * floored to 03:17:00 would refuse it. Truncation can only move a receipt's
 * stated time *earlier*, so it never manufactures a late payment — the late
 * bound is already as lenient as it needs to be, by up to the same minute.
 */
const timingMismatch = (
  receipt: AttestedReceipt,
  expectation: ReceiptExpectation
): readonly ReceiptMismatch[] => {
  const paidAt = receipt.paidAt.getTime()

  if (paidAt < atReceiptResolution(expectation.paidNotBefore))
    return [ReceiptMismatch.PAID_TOO_EARLY]
  if (paidAt > expectation.paidNotAfter.getTime()) return [ReceiptMismatch.PAID_TOO_LATE]

  return []
}
