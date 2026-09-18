import { Injectable, Logger } from '@nestjs/common'
import { BankProvider, SaleStatementRejection } from '@transacto/contracts'
import { PrivatbankDocumentApiService } from 'src/modules/receipt-verification/services/privatbank-document.api.service'
import { ReceiptCheckerApiService } from 'src/modules/receipt-verification/services/receipt-checker.api.service'
import type {
  StatementAttestation,
  StatementNotAttested,
  StatementSubmission,
  StatementVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import {
  isGranted,
  PrivatbankGrantGap,
  readGrant
} from 'src/modules/receipt-verification/utils'
import { PrivatbankDocumentType } from 'src/shared/interfaces'
import { describeError, readStatementNumber, withoutSignatureEnvelope } from 'src/shared/utils'

/**
 * **PrivatBank's statements, proven by asking PrivatBank.**
 *
 * The strongest arrangement available anywhere in this product, and stronger
 * than the monobank path it sits beside: **the upload is never evidence.** It is
 * read for one thing — the document number PrivatBank prints on every page and
 * names the file after — and then discarded. What gets parsed is the copy the
 * bank itself serves.
 *
 * So a forged statement does not have to be detected. It has to be *registered*,
 * which is not something a forger can do.
 *
 * The same two calls the receipt path already makes, with
 * `PrivatbankDocumentType.STATEMENT` in place of `RECEIPT` — captured
 * 2026-09-17. Both legs share one worker session so they leave through the same
 * Tor exit: the download's grant is bound to the `PHPSESSID` the lookup opened,
 * and a cookie minted through one circuit and presented through another is a
 * session that moved address mid-conversation.
 */
@Injectable()
export class PrivatbankStatementProvider implements StatementVerificationProvider {
  readonly name = 'privatbank.ua'

  private readonly logger = new Logger(PrivatbankStatementProvider.name)

  constructor(
    private readonly documents: PrivatbankDocumentApiService,
    private readonly checker: ReceiptCheckerApiService
  ) {}

  /**
   * PrivatBank, and only while the text extractor is configured.
   *
   * The extractor is needed even though the upload is thrown away: the number
   * has to be read out of it first, and a file somebody renamed carries it only
   * in its text.
   */
  supports(bank: BankProvider): boolean {
    return bank === BankProvider.PRIVAT && this.checker.isConfigured
  }

  async attest(submission: StatementSubmission): Promise<StatementAttestation> {
    const number = await this.numberOf(submission)
    if (typeof number !== 'string') return number

    const grant = await this.lookUp(number)
    if ('rejection' in grant) return grant

    const document = await this.documents
      .downloadDocument(PrivatbankDocumentType.STATEMENT, number, grant)
      .catch((error: unknown) => {
        this.logger.error(`PrivatBank would not serve statement ${number}: ${describeError(error)}`)

        return null
      })

    if (document === null) return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE }

    this.logger.log(`PrivatBank served its own copy of statement ${number}`)

    // Their download is a plain PDF; a statement saved by hand out of Privat24
    // is a signed container. Unwrapped unconditionally so both routes to the
    // same document arrive here in one form — a plain PDF passes through
    // untouched.
    return { bank: submission.bank, document: withoutSignatureEnvelope(document) }
  }

  /**
   * The document's own number, from its name or its text.
   *
   * **The file name first**, because a document the bank served is named after
   * its number — exact, and no extraction at all. The text is the fallback, for
   * a file somebody renamed on the way.
   */
  private async numberOf(
    submission: StatementSubmission
  ): Promise<string | StatementNotAttested> {
    const fromName = readStatementNumber(submission.bank, submission.uploaded.fileName, '')
    if (fromName !== null) return fromName

    const text = await this.checker
      .extractText(withoutSignatureEnvelope(submission.uploaded))
      .catch((error: unknown) => {
        this.logger.error(`A statement's text could not be read: ${describeError(error)}`)

        return null
      })

    if (text === null) return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE }

    const fromText = readStatementNumber(submission.bank, '', text.text)

    if (fromText === null) {
      // Not a refusal of the payment and not an accusation: this file does not
      // carry a number PrivatBank could be asked about, so there is nothing to
      // ask. Most often a statement exported from somewhere else, or a receipt.
      this.logger.warn('A PrivatBank statement carries no document number to look up')

      return { rejection: SaleStatementRejection.UNREADABLE }
    }

    return fromText
  }

  /** Whether the bank knows this number, and the grant to fetch it with. */
  private async lookUp(
    number: string
  ): Promise<{ token: string; cookie: string; session: string } | StatementNotAttested> {
    const answer = await this.documents
      .findDocument(PrivatbankDocumentType.STATEMENT, number)
      .catch((error: unknown) => {
        this.logger.error(`PrivatBank's lookup did not answer: ${describeError(error)}`)

        return null
      })

    if (answer === null) return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE }

    const read = readGrant(answer)

    if (isGranted(read)) return read.grant

    if (read.gap === PrivatbankGrantGap.DOCUMENT) {
      // Their explicit negative — the strongest refusal there is, because it is
      // the institution that would have issued the document saying it did not.
      this.logger.warn(
        `PrivatBank does not know statement ${number}: ${answer.body.reason ?? 'no reason'}`
      )

      return { rejection: SaleStatementRejection.NOT_REGISTERED }
    }

    // They know it and issued nothing usable to fetch it with, which means
    // their shape moved. Not the sender's fault, and worth an error line.
    this.logger.error(
      `PrivatBank found statement ${number} and issued no usable grant; their reply shape moved.`
    )

    return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE }
  }
}
