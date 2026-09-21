import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Logger } from '@nestjs/common'
import type { ReceiptFile } from 'src/shared/interfaces'
import { describeError } from 'src/shared/utils'

/**
 * The bytes this API keeps, and the three rules that keeping them imposes.
 *
 * Two kinds of document are archived — a bank statement sent to settle a
 * disputed card order, and a payment receipt sent to prove a fiat top-up — and
 * they are the most sensitive things this product will ever hold. A statement
 * is somebody's whole transaction history, uploaded to answer one question
 * about one payment; a receipt states a payer's and a recipient's credentials
 * in full. One implementation, because two copies of these rules would be two
 * copies to get wrong:
 *
 * - **The name is ours, never theirs.** A file is stored as its own database id
 *   and an extension from a fixed list. A name a user chose is a path a user
 *   chose, and `../../etc/anything.pdf` is a name.
 * - **Reads are by stored name, and the shape is checked first.** Every caller
 *   passes a value out of the database, and checking it anyway costs a regex
 *   and removes the whole class of question.
 * - **Nothing here logs a byte of content.** What goes in a log line is the id
 *   and the size.
 *
 * Each subclass names its own directory, which must be a mounted volume — see
 * `docker-compose.yml`. Without one, every document is lost on the next deploy
 * along with the only evidence a dispute had.
 */
export abstract class DocumentStorage {
  /** What a log line calls one of these. */
  protected abstract readonly label: string

  /**
   * The extensions a stored name may carry.
   *
   * The same list the upload was accepted against, so a file this service
   * writes is always one the product agreed to take. A statement is PDF and
   * nothing else; a receipt may also be a screenshot.
   */
  protected abstract readonly extensions: readonly string[]

  /** Read per call so a container can be reconfigured without a rebuild. */
  protected abstract get directory(): string

  protected readonly logger = new Logger(this.constructor.name)

  /**
   * A stored name this service could have produced: a 24-character hex id and
   * one of its own extensions.
   *
   * Built from {@link extensions} rather than written out, so adding a format
   * to the upload rules cannot leave the reader refusing files the writer just
   * wrote.
   */
  private get storedNamePattern(): RegExp {
    return new RegExp(`^[0-9a-f]{24}\\.(?:${this.extensions.join('|')})$`)
  }

  /**
   * Writes one document and answers what it is called.
   *
   * The name is derived from the id the database already minted, so the two
   * cannot drift and a stray file on disk is traceable to a row. `wx` rather
   * than a plain write: a name that already exists means two rows minted the
   * same id, which is a bug worth a failure rather than a silent overwrite of
   * somebody else's evidence.
   */
  async save(documentId: string, file: ReceiptFile, extension: string): Promise<string> {
    const suffix = this.extensions.includes(extension) ? extension : this.extensions[0]
    const storedName = `${documentId}.${suffix}`

    await mkdir(this.directory, { recursive: true })
    await writeFile(join(this.directory, storedName), file.buffer, { flag: 'wx' })

    this.logger.log(`Stored ${this.label} ${documentId}: ${file.buffer.length} bytes`)

    return storedName
  }

  /**
   * The stored file, as a stream for an operator to read.
   *
   * A stream rather than a buffer: these run to hundreds of kilobytes and there
   * is no reason for the process to hold one whole while a browser reads it.
   * `null` when the name is not one this service produced or the file is gone —
   * a deploy before the volume existed, or a retention sweep.
   */
  read(storedName: string): ReadStream | null {
    if (!this.storedNamePattern.test(storedName)) {
      // Never a path this service wrote, so never a path it will read. Every
      // caller reads the value out of the database; this is the belt.
      this.logger.error(`Refused to read a ${this.label} under an unrecognised name`)

      return null
    }

    const stream = createReadStream(join(this.directory, storedName))

    // Attached before the caller gets it: an `error` with no listener on a
    // stream is an unhandled rejection that takes the process down, and a
    // missing file is an ordinary outcome here.
    stream.on('error', (error) => {
      this.logger.warn(`${this.label} ${storedName} could not be read: ${describeError(error)}`)
    })

    return stream
  }

  /**
   * Removes one stored document.
   *
   * For the retention sweep: these have no reason to outlive what they settled
   * by very much. Swallows a missing file — the point is that it is gone.
   */
  async remove(storedName: string): Promise<void> {
    if (!this.storedNamePattern.test(storedName)) return

    await unlink(join(this.directory, storedName)).catch((error: unknown) => {
      this.logger.warn(`${this.label} ${storedName} could not be removed: ${describeError(error)}`)
    })
  }

  /** The directory a subclass configured, resolved, with its own default. */
  protected resolveDirectory(configured: string | undefined, fallback: string): string {
    return resolve((configured ?? '').trim() || fallback)
  }
}
