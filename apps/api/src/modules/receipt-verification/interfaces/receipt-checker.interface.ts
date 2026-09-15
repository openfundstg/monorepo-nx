import type { ReceiptTextSource } from 'src/modules/receipt-verification/enums'

/**
 * The contract with `apps/receipt-checker`, this workspace's own sidecar.
 *
 * Ours, not a third party's — both halves are in this repository and change
 * together — but it is still an HTTP boundary between two languages, so it is
 * declared as carefully as one of somebody else's.
 *
 * **Why the sidecar exists at all.** One job the API cannot do in Node without
 * dragging an OCR engine into its image: reading text out of a PDF or a
 * photograph, in a process that can be killed when a file strangers uploaded
 * turns out to be hostile.
 *
 * It used to do a second one — driving `check.gov.ua` in a real browser for a
 * reCAPTCHA token — and that is gone with the service it served. Monobank's own
 * certification service needs no token, so the browser it needed left the image
 * with it.
 */

/** What the sidecar read out of an uploaded receipt. */
export interface ReceiptTextResponse {
  /**
   * Everything readable in the file, whitespace-normalised, in reading order.
   *
   * **Never log this, and never store it.** A bank receipt states the recipient
   * in full: a monobank receipt captured on 2026-09-07 carries the payer's IBAN,
   * their masked card *and the recipient's card unmasked* — sixteen digits,
   * under "Платіжний інструмент". This string is read for one thing, a receipt
   * code, and everything else in it is a payment credential belonging to two
   * people who did not agree to it being written down. Its length is safe to
   * log and is what the facade logs.
   *
   * Empty when the file yielded nothing — a photograph too blurred to
   * recognise, a PDF with no text layer and no page image. Empty is an ordinary
   * answer, not an error.
   */
  readonly text: string
  readonly source: ReceiptTextSource
}

