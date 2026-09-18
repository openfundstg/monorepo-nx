import {
  FIAT_RECEIPT_ALLOWED_EXTENSIONS,
  FIAT_RECEIPT_ALLOWED_MIME_TYPES,
  isAcceptedUpload,
  type UploadedFileType
} from '@transacto/contracts'

/**
 * Whether a file is one Transacto's recognition will take.
 *
 * The rule is `isAcceptedUpload`, shared with the statement path: the two are
 * the same check over two lists, and only the lists are a product decision.
 * The lists differ for a reason worth keeping in view — a receipt may be a
 * screenshot because Transacto's own recognition judges it, and a statement may
 * not, because nothing downstream judges that one.
 */
export const isAcceptedReceiptFile = (file: UploadedFileType): boolean =>
  isAcceptedUpload(file, {
    extensions: FIAT_RECEIPT_ALLOWED_EXTENSIONS,
    mimeTypes: FIAT_RECEIPT_ALLOWED_MIME_TYPES
  })

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
