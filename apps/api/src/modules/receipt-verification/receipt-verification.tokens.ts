/**
 * The two collections the facade is given, rather than the two lists it would
 * otherwise hold.
 *
 * Tokens exist so that adding PrivatBank is one line in
 * `receipt-verification.module.ts` and nothing else: the facade iterates what it
 * is handed and never names a bank or a verifier. Anything injected behind one
 * of these must be substitutable without the facade special-casing it, which is
 * the whole reason the strategy knows no verifier and the provider knows no
 * bank's code format.
 */

/** `readonly ReceiptCodeStrategy[]` — one per bank whose receipts can be read. */
export const RECEIPT_CODE_STRATEGIES = 'RECEIPT_CODE_STRATEGIES'

/**
 * `readonly ReceiptVerificationProvider[]` — every service that can vouch for a
 * code, in the order they should be asked.
 */
export const RECEIPT_VERIFICATION_PROVIDERS = 'RECEIPT_VERIFICATION_PROVIDERS'
