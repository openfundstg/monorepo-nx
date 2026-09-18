import { Injectable, Logger } from '@nestjs/common'
import { BankProvider } from '@transacto/contracts'
import { AttestedDocumentKind, ReceiptLookupResult } from 'src/modules/receipt-verification/enums'
import type {
  ReceiptLookup,
  ReceiptSubmission,
  ReceiptVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import { MonobankCaApiService } from 'src/modules/receipt-verification/services/monobank-ca.api.service'
import { ReceiptCheckerApiService } from 'src/modules/receipt-verification/services/receipt-checker.api.service'
import { monobankReceiptGaps, parseMonobankReceipt } from 'src/modules/receipt-verification/utils'
import {
  MONOBANK_CA_TOTAL_PASSED,
  MONOBANK_SIGNERS,
  type MonobankCaSignature,
  type MonobankCaVerifyResponse
} from 'src/shared/interfaces'
import { UAH_CURRENCY_CODE } from 'src/shared/constants'
import {
  bankSignatureOf,
  describeError,
  describeSigners,
  SignatureRefusal
} from 'src/shared/utils'

/** Dashes are presentation; two codes are the same code without them. */
const DASHES = /-/g

/**
 * **The Adapter — monobank.** Their own certification service behind this
 * product's verification port.
 *
 * It answers the same three-outcome question as PrivatBank's adapter and does
 * something entirely different to answer it, which is the reason the port
 * exists. PrivatBank is asked whether a code exists; monobank is asked whether
 * the **file the user uploaded** carries the bank's qualified signature. One is
 * a search in somebody's index, the other is a proof about bytes — and a proof
 * is the stronger claim: a single altered bit is refused, where a lookup would
 * happily confirm a code that a forged document also prints.
 *
 * Four things about it are load-bearing:
 *
 * - **A valid signature is not a bank signature.** Anyone who holds a qualified
 *   certificate can sign a document they invented, and this service will say —
 *   truthfully — that the signature is valid. What makes it a *bank* document is
 *   the signer, so {@link MONOBANK_SIGNERS} is checked and a valid signature from
 *   anybody else is refused, loudly. Skipping that check would turn this from a
 *   forgery defence into a forgery laundry.
 * - **It verifies the upload, not a copy.** The bytes go up exactly as they
 *   arrived, envelope and all. That is also why the document handed back is the
 *   uploaded file: it has just been proven to be the bank's, so there is nothing
 *   better to fetch and nothing to fetch it from.
 * - **The service says nothing about the payment.** The sum, the recipient and
 *   the moment are read out of the document, exactly as they are for PrivatBank
 *   — from a document that is now known not to have been edited. What remains
 *   is that monobank may render the same facts differently one day, which the
 *   parser refuses rather than guesses at.
 * - **It reads the code off the document.** A code can reach this module from
 *   the file's own name, and a name costs a rename to change. What the proven
 *   document calls itself is what gets recorded.
 */
@Injectable()
export class MonobankSignatureAdapterService implements ReceiptVerificationProvider {
  readonly name = 'ca.monobank.ua'

  private readonly logger = new Logger(MonobankSignatureAdapterService.name)

  constructor(
    private readonly ca: MonobankCaApiService,
    private readonly checker: ReceiptCheckerApiService
  ) {}

  /**
   * Monobank and nothing else — this is their certification service, not a
   * registry.
   *
   * It needs the text extractor as well, because a document whose figures
   * cannot be read is a document this cannot vouch for, however genuine its
   * signature.
   */
  supports(bank: BankProvider): boolean {
    return bank === BankProvider.MONO && this.checker.isConfigured
  }

  async vouchFor(submission: ReceiptSubmission): Promise<ReceiptLookup> {
    if (!this.supports(submission.bank))
      return {
        result: ReceiptLookupResult.UNAVAILABLE,
        reason: `${submission.bank} is not a bank this verifier answers for`
      }

    const answer = await this.ca.verify(submission.uploaded).catch((error: unknown) => {
      this.logger.error(`monobank's certification service did not answer: ${describeError(error)}`)

      return null
    })

    if (answer === null)
      return {
        result: ReceiptLookupResult.UNAVAILABLE,
        reason: "monobank's certification service is unreachable"
      }

    // Their `400`, and it is an answer about the upload rather than a fault.
    // A screenshot, a re-printed PDF, anything with no signature on it lands
    // here — which is a thing this product genuinely cannot verify, not a thing
    // that went wrong.
    if ('errCode' in answer) {
      this.logger.warn(
        `${submission.code} carries no signature to check: ${answer.errCode} — ${answer.errText}`
      )

      return { result: ReceiptLookupResult.UNKNOWN }
    }

    const signature = this.banksOwnSignature(answer, submission.code)

    if (signature === null) return { result: ReceiptLookupResult.UNKNOWN }

    this.logger.log(
      `ca.monobank.ua confirms a ${signature.signType.toLowerCase()} signature by ` +
        `${signature.signerCert.organization} on ${submission.code}, ` +
        `timestamped ${signature.signingTime} (${signature.tspStatus})`
    )

    return this.read(submission)
  }

  /**
   * The bank's own valid signature on this document, or `null`.
   *
   * The rule itself lives in `bankSignatureOf`, shared with the statement path:
   * the two ask the same certification service the same question about two
   * different documents, and a second copy of "did monobank sign this" is the
   * one duplication neither could afford. What stays here is the logging, which
   * names a receipt code where the statement path names a sale.
   */
  private banksOwnSignature(
    answer: MonobankCaVerifyResponse,
    code: string
  ): MonobankCaSignature | null {
    const verdict = bankSignatureOf(answer)

    if ('signature' in verdict) return verdict.signature

    if (verdict.refusal === SignatureRefusal.NOT_THE_BANK) {
      // A valid signature by somebody who is not the bank. Ordinary corruption
      // does not produce this — it is what a document signed with a certificate
      // its author bought looks like, so it is worth an error line rather than
      // a shrug.
      this.logger.error(
        `${code} carries a valid signature by nobody this build recognises: ` +
          `${describeSigners(answer)}. Either a forgery, or the bank has changed ` +
          `certificate again — in which case that pair is what MONOBANK_SIGNERS is missing.`
      )

      return null
    }

    this.logger.warn(
      `${code} does not verify: signatureValid ${answer.signatureValid}, ` +
        `${answer.protocolInfo.mainIndication} across ` +
        `${answer.protocolInfo.signatures.length} signature(s)`
    )

    return null
  }

  /**
   * Reads the three facts a payout is matched by, out of the proven document.
   *
   * A failure here is `UNAVAILABLE`, never `UNKNOWN`: the signature has already
   * established that this is the bank's receipt, and reporting "we do not know
   * this receipt" because *we* could not read their layout would refuse a user
   * for our own problem.
   */
  private async read(submission: ReceiptSubmission): Promise<ReceiptLookup> {
    const text = await this.text(submission)

    if (text === null)
      return { result: ReceiptLookupResult.UNAVAILABLE, reason: 'the document could not be read' }

    const fields = parseMonobankReceipt(text)

    if (fields === null) {
      // The document is genuine and this build could not read it, which is the
      // shape a change in their rendering takes. Loud, because the alternative
      // is a run of receipts quietly going to operators.
      this.logger.error(
        `${submission.code} is genuine and its layout could not be read: ` +
          `${text.length} characters, and these labels were not found — ` +
          monobankReceiptGaps(text).join(', ')
      )

      return { result: ReceiptLookupResult.UNAVAILABLE, reason: 'the document could not be read' }
    }

    if (this.bare(fields.code) !== this.bare(submission.code)) {
      // Only reachable when the code came from the file's name, which a user
      // can rename. The document's own number wins; the disagreement is worth
      // a line because it is also what a mistaken upload looks like.
      this.logger.warn(
        `the upload was identified as ${submission.code} and the document calls ` +
          `itself ${fields.code}; taking the document's own number`
      )
    }

    this.logger.log(
      `read ${fields.code}: ${fields.amountUah} kopecks, paid ${fields.paidAt.toISOString()}`
    )

    return {
      result: ReceiptLookupResult.FOUND,
      receipt: {
        bank: BankProvider.MONO,
        code: fields.code,
        amountUah: fields.amountUah,
        paidAt: fields.paidAt,
        // The receipt states its sum under a `(грн)` label and carries no
        // numeric code of its own. Declared rather than left absent, because
        // the matching rules treat a missing currency as a mismatch —
        // correctly, since a bare number compared against a payout is how ₴500
        // gets settled by $500.
        currencyCode: UAH_CURRENCY_CODE,
        // Unmasked on a monobank receipt, so the recipient check is exact
        // rather than probabilistic. A payment credential: never logged, only
        // compared.
        recipient: fields.recipientCard,
        // The document, **not** the envelope that was verified. Transacto's
        // recognition reads a PDF and fails on a PKCS#7 container in the one
        // way that looks like the user's fault — so what was proven is the
        // envelope and what is forwarded is what is inside it. There is nothing
        // better to send and nowhere to fetch it from.
        document: { kind: AttestedDocumentKind.FILE, file: submission.document }
      }
    }
  }

  /**
   * The document's text — reused when the facade already read it.
   *
   * The facade extracts text to find a code, unless the file's own name carried
   * one. So this is usually free and occasionally an extraction, and never two
   * extractions of the same document.
   */
  private async text(submission: ReceiptSubmission): Promise<string | null> {
    if (submission.text !== null) return submission.text

    const extracted = await this.checker
      .extractText(submission.document)
      .catch((error: unknown) => {
        this.logger.error(`${submission.code} could not be extracted: ${describeError(error)}`)

        return null
      })

    return extracted === null ? null : extracted.text
  }

  private bare(code: string): string {
    return code.replace(DASHES, '').toUpperCase()
  }
}
