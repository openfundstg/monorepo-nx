/**
 * Whether a file somebody uploaded is a kind this product will look at.
 *
 * One statement of a rule that was written twice — once for a payment receipt
 * and once for a bank statement — and they were the same rule with two lists.
 * Which lists differ is a product decision (a receipt may be a screenshot, a
 * statement may not); how a type is *decided* is not, and it is subtle enough
 * to be worth having in one place.
 *
 * **The extension decides and the MIME type may only disqualify.** A Telegram
 * WebView reports `image/jpg` (not a registered type), `application/octet-stream`
 * or an empty string for the same file depending on the phone, so a check that
 * trusted it would refuse perfectly good documents. An empty or unknown type is
 * therefore not a refusal; a type that is definitely something else is.
 */
export interface AcceptedUploadTypes {
  /** Lower-case, without the dot. */
  readonly extensions: readonly string[];
  /** Advisory — see above. */
  readonly mimeTypes: readonly string[];
}

export interface UploadedFileType {
  readonly fileName: string;
  readonly mimeType: string;
}

export const isAcceptedUpload = (
  file: UploadedFileType,
  accepted: AcceptedUploadTypes,
): boolean => {
  const extension = file.fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  if (!accepted.extensions.includes(extension)) return false;

  // The parameters after a `;` are the charset and the boundary, never the type.
  const mimeType = file.mimeType.toLowerCase().split(';')[0].trim();

  return mimeType === '' || accepted.mimeTypes.includes(mimeType);
};
