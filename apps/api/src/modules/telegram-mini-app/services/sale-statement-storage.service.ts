import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import environments from 'src/environments'
import type { ReceiptFile } from 'src/shared/interfaces'
import { describeError } from 'src/shared/utils'

/** Where statements are kept when nothing says otherwise. */
const DEFAULT_DIR = '/var/lib/transacto/statements'

/** The only extension a statement is accepted as, so the only one written. */
const EXTENSION = 'pdf'

/** A stored name this service produced: 24 hex characters and `.pdf`. */
const STORED_NAME = /^[0-9a-f]{24}\.pdf$/

/**
 * The only bytes this API keeps.
 *
 * Everything else it handles is forwarded and forgotten — a fiat receipt goes
 * to Transacto and leaves nothing behind. A statement cannot work that way:
 * nobody downstream judges it, so an operator has to be able to open the exact
 * document a dispute was settled on, months later.
 *
 * **It is also the most sensitive thing the product will ever hold** — somebody's
 * whole transaction history, uploaded to answer one question about one payment.
 * Three consequences, all of them in the code below:
 *
 * - **The name is ours, never theirs.** A file is stored as its own database id
 *   and nothing else. A name a user chose is a path a user chose, and
 *   `../../etc/anything.pdf` is a name.
 * - **Reads are by stored name, and the shape is checked first.** The one caller
 *   passes a value out of the database, and checking it anyway costs a regex
 *   and removes the whole class of question.
 * - **Nothing here logs a byte of content.** What goes in a log line is the id
 *   and the size.
 *
 * The directory must be a mounted volume — `statements_data` in
 * `docker-compose.yml`. Without one, every statement is lost on the next
 * deploy along with the only evidence a dispute had.
 */
@Injectable()
export class SaleStatementStorageService {
  private readonly logger = new Logger(SaleStatementStorageService.name)

  /** Read per call so a container can be reconfigured without a rebuild. */
  private get directory(): string {
    return resolve((environments.SALE_STATEMENT_STORAGE_DIR ?? '').trim() || DEFAULT_DIR)
  }

  /**
   * Writes one statement and answers what it is called.
   *
   * The name is derived from the id the database already minted, so the two
   * cannot drift and a stray file on disk is traceable to a row.
   */
  async save(statementId: string, file: ReceiptFile): Promise<string> {
    const storedName = `${statementId}.${EXTENSION}`

    await mkdir(this.directory, { recursive: true })
    await writeFile(join(this.directory, storedName), file.buffer, { flag: 'wx' })

    this.logger.log(`Stored statement ${statementId}: ${file.buffer.length} bytes`)

    return storedName
  }

  /**
   * The stored file, as a stream for an operator's download.
   *
   * A stream rather than a buffer: these run to hundreds of kilobytes and there
   * is no reason for the process to hold one whole while a browser reads it.
   * `null` when the name is not one this service produced or the file is gone —
   * a deploy before the volume existed, or a retention sweep.
   */
  read(storedName: string): ReadStream | null {
    if (!STORED_NAME.test(storedName)) {
      // Never a path this service wrote, so never a path it will read. The one
      // caller reads the value out of the database; this is the belt.
      this.logger.error(`Refused to read a statement under an unrecognised name`)

      return null
    }

    const stream = createReadStream(join(this.directory, storedName))

    // Attached before the caller gets it: an `error` with no listener on a
    // stream is an unhandled rejection that takes the process down, and a
    // missing file is an ordinary outcome here.
    stream.on('error', (error) => {
      this.logger.warn(`Statement ${storedName} could not be read: ${describeError(error)}`)
    })

    return stream
  }

  /**
   * Removes one stored statement.
   *
   * For the retention sweep that does not exist yet and should: these documents
   * have no reason to outlive the dispute they settled by very much. Swallows a
   * missing file — the point is that it is gone.
   */
  async remove(storedName: string): Promise<void> {
    if (!STORED_NAME.test(storedName)) return

    await unlink(join(this.directory, storedName)).catch((error: unknown) => {
      this.logger.warn(`Statement ${storedName} could not be removed: ${describeError(error)}`)
    })
  }
}
