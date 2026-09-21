import { Injectable } from '@nestjs/common'
import { FIAT_RECEIPT_ALLOWED_EXTENSIONS } from '@transacto/contracts'
import environments from 'src/environments'
import type { ReceiptFile } from 'src/shared/interfaces'
import { DocumentStorage } from './document-storage.base'

/** Where receipts are kept when nothing says otherwise. */
const DEFAULT_DIR = '/var/lib/transacto/receipts'

/**
 * The payment receipts users send against a fiat top-up.
 *
 * **This product used to keep none of them**, and the reason it now does is
 * that "forwarded and forgotten" is only true of the happy path. A top-up
 * disputed a month later is settled by looking at what the payer actually sent,
 * and what they sent was reachable only through Transacto's own panel — a
 * counterparty's UI, for evidence about our own user's money. A receipt
 * Transacto refused had no copy anywhere at all, which is precisely the receipt
 * an operator is asked about.
 *
 * **The file is archived exactly as it arrived**, envelope and all. A receipt
 * saved out of a banking app is a signed PKCS#7 container, and the signature is
 * over those precise bytes — unwrapping before storing would destroy the only
 * thing that makes the document evidence. What goes upstream is a different
 * question, answered in `FiatDepositReceiptService`.
 *
 * Wider than the statement archive on purpose: a receipt may be a screenshot,
 * because a receipt is forwarded to a counterparty who judges it. See
 * `FIAT_RECEIPT_ALLOWED_EXTENSIONS`.
 */
@Injectable()
export class FiatReceiptStorageService extends DocumentStorage {
  protected readonly label = 'receipt'
  protected readonly extensions = FIAT_RECEIPT_ALLOWED_EXTENSIONS

  protected get directory(): string {
    return this.resolveDirectory(environments.FIAT_RECEIPT_STORAGE_DIR, DEFAULT_DIR)
  }

  /**
   * Writes one receipt under the id its row already carries.
   *
   * The extension comes from the upload's own name rather than from its
   * `Content-Type`, for the reason `FIAT_RECEIPT_ALLOWED_MIME_TYPES` spells
   * out: a Telegram WebView reports whatever it likes, including nothing.
   */
  override async save(receiptId: string, file: ReceiptFile, extension: string): Promise<string> {
    return super.save(receiptId, file, extension.toLowerCase())
  }
}
