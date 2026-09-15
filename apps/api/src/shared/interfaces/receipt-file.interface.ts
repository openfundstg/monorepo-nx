/**
 * A receipt as bytes, decoupled from however it arrived.
 *
 * Deliberately not `Express.Multer.File`: a receipt is uploaded by a user, is
 * fetched from a bank, and is posted to two different systems, and only one of
 * those four is a web request. Typing it to the framework would make the whole
 * path untestable without one and unusable from a worker.
 *
 * It lives in `shared/` because three modules now name it — the Transacto panel
 * that uploads it, the verification that reads a code out of it, and the fiat
 * top-up that carries it between them. It was `PanelReceiptFile` in
 * `modules/transacto/` until the second of those appeared, which would have
 * made a verification module depend on the panel for the shape of a file.
 */
export interface ReceiptFile {
  readonly buffer: Buffer
  /** Sent as the multipart filename. The panel keys its recognition off the extension. */
  readonly fileName: string
  readonly mimeType: string
}
