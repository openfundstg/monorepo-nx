/**
 * The three facts read off a monobank receipt, once its signature has proven
 * the document genuine.
 *
 * Separate from the signature's own verdict because they come from different
 * places and have different failure modes: the signature is checked by
 * monobank's service and either holds or does not, while these are read from a
 * rendered layout that can change without anybody being told.
 */
export interface MonobankReceiptFields {
  /**
   * The receipt number the document itself prints.
   *
   * Read here rather than trusted from outside, and the difference is not
   * academic: a code may reach this module from the **file's own name**, which
   * costs a user one rename to change. The signature proves the document; this
   * is what the proven document calls itself.
   */
  readonly code: string
  /** UAH kopecks. */
  readonly amountUah: number
  /** When the transfer was executed, as an instant. */
  readonly paidAt: Date
  /**
   * The recipient's card, as the receipt printed it — sixteen characters,
   * masked or whole.
   *
   * Monobank prints the recipient's in full on the receipts captured so far and
   * masks the *payer's* on the same document, so both forms are accepted and
   * `matchesMaskedCard` compares whichever arrives. A stranger's payment
   * credential either way: **never log it.**
   */
  readonly recipientCard: string
}
