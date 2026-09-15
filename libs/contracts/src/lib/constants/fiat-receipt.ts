/**
 * What a payment receipt may be, shared so the Mini App refuses a file before
 * spending a user's mobile data on it and the backend refuses it again.
 *
 * The list mirrors what Transacto's own uploader accepts — PDF plus PNG, JPEG
 * and WebP. Anything outside it is refused upstream after a full round trip
 * with the file attached, which on a phone is the slowest possible way to learn
 * the answer.
 */
export const FIAT_RECEIPT_ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;

/**
 * Acceptable `Content-Type` values, **advisory only**.
 *
 * The extension is what decides. A browser reports whatever it likes for a file
 * picked out of a Telegram WebView — `image/jpg` (not a registered type) and an
 * empty string are both routine — so a check that trusted this list alone would
 * reject perfectly good screenshots. `image/jpg` is listed for exactly that
 * reason rather than by mistake.
 */
export const FIAT_RECEIPT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

/**
 * Largest receipt accepted, in bytes.
 *
 * **Our figure, not Transacto's** — theirs is undocumented and has not been
 * probed. Ten megabytes is far above any bank's PDF or a phone screenshot,
 * which makes it a guard against a mis-picked file rather than a limit a real
 * receipt can hit.
 */
export const FIAT_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
