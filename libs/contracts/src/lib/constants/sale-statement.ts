import { isAcceptedUpload, type UploadedFileType } from './upload.js';

/**
 * What a bank statement may be, shared so the Mini App refuses a file before
 * spending a user's mobile data on it and the backend refuses it again.
 *
 * **PDF and nothing else** — and the narrowness is the point, not an
 * oversight. A statement is asked to prove that a payment is *absent*, which a
 * screenshot cannot do: anyone can produce one showing anything. The only thing
 * that makes the document evidence is the bank's qualified signature over its
 * exact bytes, and a bank signs the PDF it serves. An image is not a
 * lower-quality statement; it is not a statement.
 *
 * This is deliberately stricter than {@link FIAT_RECEIPT_ALLOWED_EXTENSIONS},
 * which accepts screenshots because a receipt is forwarded to a counterparty
 * who judges it. Nobody downstream judges this one.
 */
export const SALE_STATEMENT_ALLOWED_EXTENSIONS = ['pdf'] as const;

/**
 * Acceptable `Content-Type` values, **advisory only**.
 *
 * The extension decides, for the reason spelled out on
 * {@link FIAT_RECEIPT_ALLOWED_MIME_TYPES}: a Telegram WebView reports whatever
 * it likes, including an empty string.
 */
export const SALE_STATEMENT_ALLOWED_MIME_TYPES = ['application/pdf'] as const;

/**
 * Largest statement accepted, in bytes.
 *
 * **Pinned to the receipt checker's own ceiling on purpose.** The document is
 * sent to `apps/receipt-checker` to have its text read, and that service refuses
 * anything above its `MAX_UPLOAD_BYTES`. A larger limit here would accept a file,
 * store it, and only then discover nothing can read it — so the two numbers move
 * together or not at all.
 *
 * A month of transactions is a few hundred kilobytes, so this is a guard against
 * a mis-picked file rather than a limit a real statement can reach.
 */
export const SALE_STATEMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Whether a file is a statement this product can even attempt to check.
 *
 * The rule itself is `isAcceptedUpload`, shared with the receipt path — the two
 * differ only in which lists they carry. It lives in this package rather than
 * beside the receipt's because the Mini App needs it too: a statement is the
 * largest thing this product ever asks a user to upload, and finding out it was
 * the wrong type after sending it is the slowest possible way to learn.
 */
export const isAcceptedStatementFile = (file: UploadedFileType): boolean =>
  isAcceptedUpload(file, {
    extensions: SALE_STATEMENT_ALLOWED_EXTENSIONS,
    mimeTypes: SALE_STATEMENT_ALLOWED_MIME_TYPES,
  });
