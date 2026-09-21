import { Injectable } from '@nestjs/common'
import { SALE_STATEMENT_ALLOWED_EXTENSIONS } from '@transacto/contracts'
import environments from 'src/environments'
import type { ReceiptFile } from 'src/shared/interfaces'
import { DocumentStorage } from './document-storage.base'

/** Where statements are kept when nothing says otherwise. */
const DEFAULT_DIR = '/var/lib/transacto/statements'

/**
 * The statements an operator settles disputes on.
 *
 * A statement cannot be forwarded and forgotten the way a receipt once was:
 * nobody downstream judges it, so an operator has to be able to open the exact
 * document a dispute was settled on, months later. Everything about *how* it is
 * kept lives in {@link DocumentStorage}, which the receipt archive shares.
 *
 * **PDF and nothing else**, because that is the only thing a statement may be —
 * see `SALE_STATEMENT_ALLOWED_EXTENSIONS`. An image is not a lower-quality
 * statement; it is not a statement.
 */
@Injectable()
export class SaleStatementStorageService extends DocumentStorage {
  protected readonly label = 'statement'
  protected readonly extensions = SALE_STATEMENT_ALLOWED_EXTENSIONS

  protected get directory(): string {
    return this.resolveDirectory(environments.SALE_STATEMENT_STORAGE_DIR, DEFAULT_DIR)
  }

  /**
   * Writes one statement.
   *
   * The extension is not a parameter here: there is exactly one it can be, and
   * taking it from a caller would invite a caller to pass something else.
   */
  override async save(statementId: string, file: ReceiptFile): Promise<string> {
    return super.save(statementId, file, SALE_STATEMENT_ALLOWED_EXTENSIONS[0])
  }
}
