import { Injectable, Logger } from '@nestjs/common'
import { BankProvider, SaleStatementRejection } from '@transacto/contracts'
import { MonobankCaApiService } from 'src/modules/receipt-verification/services/monobank-ca.api.service'
import type {
  StatementAttestation,
  StatementSubmission,
  StatementVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import {
  bankSignatureOf,
  describeError,
  describeSigners,
  SignatureRefusal,
  withoutSignatureEnvelope
} from 'src/shared/utils'

/**
 * **Monobank's statements, proven by the signature on the bytes.**
 *
 * The same certification service the receipt path already uses, asked the same
 * question about a different document — and it needs nothing added for it: the
 * signer on a statement is the first entry of `MONOBANK_SIGNERS` already,
 * because it is the same bank signing the same way.
 *
 * Three things this shares with the receipt adapter, and each is the reason it
 * exists at all:
 *
 * - **`signatureValid: true` proves nothing about the bank.** A qualified
 *   certificate can be bought by anybody, so a forger signs their own invented
 *   statement and the service confirms — truthfully — that the signature holds.
 *   The signer is what makes it a bank document.
 * - **The bytes go up exactly as they arrived**, envelope and all. A signature
 *   is over those precise bytes, and unwrapping first would hand the service a
 *   document it must refuse.
 * - **A refusal is a `200`.** Only a body that is not a signed container at all
 *   answers with an error code, so reading the status alone would record a
 *   forgery as a success.
 *
 * What it does *not* share: there is no code to look up and no copy to fetch.
 * A monobank statement carries no document number, so the upload — once proven
 * — is the document.
 */
@Injectable()
export class MonobankStatementProvider implements StatementVerificationProvider {
  readonly name = 'ca.monobank.ua'

  private readonly logger = new Logger(MonobankStatementProvider.name)

  constructor(private readonly ca: MonobankCaApiService) {}

  supports(bank: BankProvider): boolean {
    return bank === BankProvider.MONO
  }

  async attest(submission: StatementSubmission): Promise<StatementAttestation> {
    const answer = await this.ca.verify(submission.uploaded).catch((error: unknown) => {
      this.logger.error(
        `monobank's certification service did not answer: ${describeError(error)}`
      )

      return null
    })

    // Unreachable, not refused. Blaming the sender for our own dependency being
    // unwell is the one thing this must not do.
    if (answer === null) return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE }

    if ('errCode' in answer) {
      // Their error code means the body was not a signed container at all — a
      // screenshot, or a statement re-saved by a PDF viewer, which strips the
      // signature that made it evidence.
      this.logger.warn(`A statement carries no signature to check: ${answer.errCode}`)

      return { rejection: SaleStatementRejection.SIGNATURE_INVALID }
    }

    const verdict = bankSignatureOf(answer)

    if ('refusal' in verdict) {
      if (verdict.refusal === SignatureRefusal.NOT_THE_BANK) {
        // Ordinary corruption does not produce this. It is what a document
        // signed with a certificate its author bought looks like, so it is
        // worth an error line rather than a shrug.
        this.logger.error(
          `A statement carries a valid signature by nobody this build recognises: ` +
            `${describeSigners(answer)}. Either a forgery, or the bank has changed ` +
            `certificate again — in which case that pair is what MONOBANK_SIGNERS is missing.`
        )

        return { rejection: SaleStatementRejection.NOT_A_BANK_SIGNER }
      }

      return { rejection: SaleStatementRejection.SIGNATURE_INVALID }
    }

    this.logger.log(
      `A monobank statement verified: signed by ${verdict.signature.signerCert.organization}`
    )

    // Proven, so now it may be unwrapped: the text lives in the document inside
    // the envelope, and the envelope has done its job.
    return { bank: submission.bank, document: withoutSignatureEnvelope(submission.uploaded) }
  }
}
