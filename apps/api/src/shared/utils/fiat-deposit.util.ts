import {
  FIAT_RECEIPT_ALLOWED_EXTENSIONS,
  FIAT_RECEIPT_ALLOWED_MIME_TYPES
} from '@transacto/contracts'

/**
 * Whether a file is one Transacto's recognition will take.
 *
 * The extension decides, and the MIME type is only allowed to disqualify a file
 * when it says something definite: a Telegram WebView reports `image/jpg`,
 * `application/octet-stream` or nothing at all for the same screenshot
 * depending on the phone, and a check that trusted it would refuse receipts
 * that are perfectly fine.
 */
export const isAcceptedReceiptFile = (file: {
  readonly fileName: string
  readonly mimeType: string
}): boolean => {
  const extension = file.fileName.split('.').pop()?.toLowerCase() ?? ''
  if (!FIAT_RECEIPT_ALLOWED_EXTENSIONS.includes(extension as never)) return false

  const mimeType = file.mimeType.toLowerCase().split(';')[0].trim()

  return mimeType === '' || FIAT_RECEIPT_ALLOWED_MIME_TYPES.includes(mimeType as never)
}

/**
 * UAH kopecks from the hryvnia figure Transacto reads off a receipt.
 *
 * Their JSON states amounts as plain numbers (`600`), where their tables state
 * them as decimal strings (`'600.00'`) — two representations on one host, and
 * this is the one for the JSON. Rounded because a float is what arrived; the
 * value itself never has more than two decimals.
 */
export const receiptAmountToKopecks = (totalAmount: number): number | null =>
  Number.isFinite(totalAmount) && totalAmount > 0 ? Math.round(totalAmount * 100) : null
