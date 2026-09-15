/**
 * How verifying one receipt ended.
 *
 * Five outcomes and not a boolean, because the four failures lead four
 * different places: one is the user's to fix, one is evidence of a forged code,
 * one is evidence of the wrong receipt, and one is nobody's fault and must
 * never be recorded as a refusal.
 */
export enum ReceiptVerificationOutcome {
  /** The state service names a payment, and it is this payout's. */
  VERIFIED = 'VERIFIED',
  /**
   * Authentic, for the right sum, at the right time — and paid to a recipient
   * this product has no way to check.
   *
   * Reached on exactly one combination and nothing looser: a PrivatBank receipt
   * for a transfer that stayed inside PrivatBank, where their document names the
   * recipient's IBAN instead of a card, and Transacto's payout row leaves
   * `recipient_name` empty. There is nothing on either side to compare, so the
   * check does not fail — it does not run.
   *
   * Kept apart from {@link VERIFIED} because it is a weaker claim and must not
   * be recorded as the stronger one. What a caller does with it is a decision
   * about money and belongs to whoever owns the top-up, not here.
   */
  VERIFIED_EXCEPT_RECIPIENT = 'VERIFIED_EXCEPT_RECIPIENT',
  /** No bank this product knows issues a code in the shape this file carries. */
  CODE_NOT_FOUND = 'CODE_NOT_FOUND',
  /** The service was asked and does not know the code. */
  NOT_REGISTERED = 'NOT_REGISTERED',
  /** A real payment, and not the one this top-up is waiting for. */
  MISMATCHED = 'MISMATCHED',
  /** Nothing was established either way — the service could not be reached. */
  UNAVAILABLE = 'UNAVAILABLE'
}

/**
 * Which of the payout's terms the receipt disagreed with.
 *
 * Every member is safe to log, which is the reason this is an enum and not the
 * sentence it would otherwise be: the disagreement is *about* a card number and
 * a name, and a free-text reason would carry a stranger's payment credentials
 * into the log the moment somebody wrote a helpful message.
 */
export enum ReceiptMismatch {
  /** The sum paid is not the sum still outstanding on this payout. */
  AMOUNT = 'AMOUNT',
  /** Paid to a different card. */
  RECIPIENT = 'RECIPIENT',
  /**
   * The receipt names an account, not a card, so the two cannot be compared.
   *
   * Ordinary rather than exceptional: PrivatBank prints the recipient's IBAN on
   * every transfer that stays inside PrivatBank, and nothing derives a card
   * from an IBAN. Its own member so that an operator sees "this one needs a
   * person" instead of "this one did not match", and so the logs do not read as
   * a run of failed verifications.
   */
  RECIPIENT_NOT_A_CARD = 'RECIPIENT_NOT_A_CARD',
  /**
   * The verifier's recipient string carried no card this build can read.
   *
   * Treated as a mismatch rather than waved through: the card is the strongest
   * of the three checks, and a receipt whose recipient cannot be read is a
   * receipt whose recipient has not been checked. It is also the shape a change
   * in their rendering would take, so it is logged as loudly as a real refusal.
   */
  RECIPIENT_UNREADABLE = 'RECIPIENT_UNREADABLE',
  /** Paid before this top-up was ever reserved — an older transfer, reused. */
  PAID_TOO_EARLY = 'PAID_TOO_EARLY',
  /** Paid after the window closed. */
  PAID_TOO_LATE = 'PAID_TOO_LATE',
  /** Not hryvnia. */
  CURRENCY = 'CURRENCY'
}

/** What the state service had to say about a code, before it is matched. */
export enum ReceiptLookupResult {
  FOUND = 'FOUND',
  /** Answered, and knows nothing about this code. */
  UNKNOWN = 'UNKNOWN',
  /** Did not answer, or answered something this build cannot read. */
  UNAVAILABLE = 'UNAVAILABLE'
}

/** Where the text a code was read out of came from. */
export enum ReceiptTextSource {
  /** The PDF's own text layer — exact, and the only source that cannot misread. */
  PDF_TEXT = 'PDF_TEXT',
  /** Optical recognition of an image. */
  OCR = 'OCR',
  /** The uploaded file's name, which for a bank's own download is the code. */
  FILE_NAME = 'FILE_NAME'
}

/**
 * How a verifier handed over the bank's own document.
 *
 * Not an implementation detail of one provider: it is the shape of what a
 * verifier is able to give. **A `URL` member used to sit here** and was removed
 * with `check.gov.ua`, which was the only thing that published a bearer link.
 * Both verifiers left are holding the bytes by the time they can vouch at all,
 * so a member for a link nothing produces would be a branch every consumer had
 * to carry for a case that cannot occur.
 */
export enum AttestedDocumentKind {
  FILE = 'FILE',
  NONE = 'NONE'
}
