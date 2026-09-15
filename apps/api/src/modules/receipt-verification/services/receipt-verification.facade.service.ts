import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  AttestedDocumentKind,
  ReceiptLookupResult,
  ReceiptMismatch,
  ReceiptTextSource,
  ReceiptVerificationOutcome
} from 'src/modules/receipt-verification/enums'
import type {
  AttestedReceipt,
  ReceiptAttestation,
  ExtractedReceiptCode,
  ReceiptCodeStrategy,
  ReceiptExpectation,
  ReceiptVerification,
  ReceiptVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import {
  RECEIPT_CODE_STRATEGIES,
  RECEIPT_VERIFICATION_PROVIDERS
} from 'src/modules/receipt-verification/receipt-verification.tokens'
import { ReceiptCheckerApiService } from 'src/modules/receipt-verification/services/receipt-checker.api.service'
import { matchReceipt } from 'src/modules/receipt-verification/utils'
import type { ReceiptFile } from 'src/shared/interfaces'
import { describeError, withoutSignatureEnvelope } from 'src/shared/utils'

/**
 * **The Facade.** Proving a receipt, in one call.
 *
 * Behind it: text is read out of the file, each bank's strategy is asked
 * whether the code in it is one of theirs, a provider is asked whether that code
 * names a real payment, and the payment is matched against what the payout
 * actually expects. Four collaborators, four ways to fail, and one method — a
 * caller settling somebody's money should not be assembling that sequence, and
 * two callers assembling it differently is how one of them ends up skipping the
 * card check.
 *
 * What it deliberately does not do is decide anything about a top-up. It
 * returns a verdict on a receipt; whether that verdict rejects an upload, holds
 * a payout or calls an operator belongs to the service that owns the top-up.
 *
 * **Order matters and is not an implementation detail.** The verification runs
 * before anything is sent to Transacto, so a receipt the state does not vouch
 * for never becomes an upload — which is the difference between refusing a
 * forged receipt and asking a counterparty to refuse it for us.
 */
/**
 * What a log line says about a receipt whose caller gave no correlation label.
 *
 * Every line this service prints carries the caller's context, so one receipt's
 * progress can be followed through a busy log. Callers inside this product
 * always pass one; the default exists so that a test or a script does not have
 * to invent one.
 */
const ANONYMOUS = '[receipt]'

@Injectable()
export class ReceiptVerificationFacadeService {
  private readonly logger = new Logger(ReceiptVerificationFacadeService.name)

  constructor(
    private readonly checker: ReceiptCheckerApiService,
    @Inject(RECEIPT_CODE_STRATEGIES)
    private readonly strategies: readonly ReceiptCodeStrategy[],
    @Inject(RECEIPT_VERIFICATION_PROVIDERS)
    private readonly providers: readonly ReceiptVerificationProvider[]
  ) {}

  /** Whether verification is wired up at all. */
  get isConfigured(): boolean {
    return this.checker.isConfigured
  }

  /**
   * What this receipt is, and whether it is this payout's.
   *
   * Never throws for a receipt it dislikes: every ending is one of the outcomes,
   * because a caller holding a user's money mid-upload needs a verdict it can
   * record, not an exception it has to classify.
   */
  async verify(
    file: ReceiptFile,
    expectation: ReceiptExpectation,
    context = ANONYMOUS
  ): Promise<ReceiptVerification> {
    const startedAt = Date.now()
    const attestation = await this.attest(file, context)

    if (!attestation.attested) return attestation.failure

    const { receipt, source } = attestation
    const { bank, code } = receipt
    const reasons = matchReceipt(receipt, expectation)

    // The one disagreement that is not a disagreement. A PrivatBank transfer
    // that stayed inside PrivatBank names the recipient's IBAN rather than a
    // card, and Transacto leaves `recipient_name` empty on its payouts — so
    // there is nothing on either side to compare and the check does not run.
    // Only ever *alone*: the moment anything else is off, this is an ordinary
    // mismatch, because a receipt that already disagrees about the sum has not
    // earned the benefit of the doubt about the recipient.
    if (reasons.length === 1 && reasons[0] === ReceiptMismatch.RECIPIENT_NOT_A_CARD) {
      this.logger.warn(
        `${context} ${code} matches this payout on every check that could run — ` +
          `${receipt.amountUah} kopecks, paid ${receipt.paidAt.toISOString()} — ` +
          'and neither side states the recipient in a comparable form, so it goes to ' +
          'Transacto with that one check unmade'
      )

      return {
        outcome: ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT,
        receipt,
        source
      }
    }

    if (reasons.length > 0) {
      this.logger.warn(
        `${context} ${bank} receipt ${code} is genuine and is not this payout's ` +
          `(${reasons.join(', ')}): it states ${receipt.amountUah} kopecks at ` +
          `${receipt.paidAt.toISOString()}, against ${expectation.amountUah} kopecks ` +
          `between ${expectation.paidNotBefore.toISOString()} and ` +
          `${expectation.paidNotAfter.toISOString()}`
      )

      return { outcome: ReceiptVerificationOutcome.MISMATCHED, bank, code, reasons }
    }

    // The overage is named rather than folded into "they agree", because a
    // receipt accepted for more than the payout is a fee the payer covered and
    // an operator reading this later should see that it was, not wonder why two
    // different numbers were called equal.
    const overpaid = receipt.amountUah - expectation.amountUah

    this.logger.log(
      `${context} ${code} verified against this payout in ${Date.now() - startedAt} ms: ` +
        'sum, currency, recipient and timing all agree' +
        (overpaid > 0
          ? `, with ${overpaid} kopecks of fee the payer covered on top of ` +
            `${expectation.amountUah} — the payout's amount is what gets credited`
          : '')
    )

    return { outcome: ReceiptVerificationOutcome.VERIFIED, receipt, source }
  }

  /**
   * Everything up to the verdict: read the code, find who answers for that bank,
   * and ask them.
   *
   * Split out from {@link verify}, which goes on to match a payout, because the
   * two questions are genuinely separate: whether a receipt is real, and
   * whether it is *this* payout's. Anything that needs only the first — a
   * reconciler, a check made before a payout is reserved — asks here rather
   * than inventing a payout to match against.
   */
  async attest(file: ReceiptFile, context = ANONYMOUS): Promise<ReceiptAttestation> {
    this.logger.log(
      `${context} verifying a receipt: ${file.buffer.byteLength} bytes of ` +
        `${file.mimeType || 'an unstated type'}`
    )

    const document = this.unwrapped(file, context)
    const extracted = await this.readCode(file, document, context)

    if (extracted === null)
      return { attested: false, failure: { outcome: ReceiptVerificationOutcome.CODE_NOT_FOUND } }

    const { bank, code, source, text } = extracted
    const provider = this.providers.find((candidate) => candidate.supports(bank))

    if (provider === undefined) {
      this.logger.error(
        `${context} read a ${bank} code and no verifier claims ${bank} — ` +
          'the module lists a strategy for a bank no provider supports'
      )

      return {
        attested: false,
        failure: {
          outcome: ReceiptVerificationOutcome.UNAVAILABLE,
          reason: `no verifier answers for ${bank}`
        }
      }
    }

    this.logger.log(`${context} asking ${provider.name} about ${bank} receipt ${code}`)

    const askedAt = Date.now()
    // Both halves travel: the untouched upload, because a signature is over
    // those precise bytes, and the unwrapped document with whatever text was
    // already read from it. Which of them a verifier uses is its own business.
    const lookup = await provider.vouchFor({ bank, code, uploaded: file, document, text })
    const asked = Date.now() - askedAt

    if (lookup.result === ReceiptLookupResult.UNAVAILABLE) {
      this.logger.error(
        `${context} ${provider.name} could not answer for ${code} after ${asked} ms: ` +
          lookup.reason
      )

      return {
        attested: false,
        failure: { outcome: ReceiptVerificationOutcome.UNAVAILABLE, reason: lookup.reason }
      }
    }

    if (lookup.result === ReceiptLookupResult.UNKNOWN) {
      // "Would not vouch for", not "does not know": the two providers answer
      // different questions — PrivatBank is asked whether a code exists, and
      // monobank whether the uploaded bytes carry the bank's signature. Phrasing
      // both as a failed lookup sent one investigation looking for a missing
      // registry entry while the real answer was a certificate the bank had
      // changed, and which the adapter had already named one line above.
      this.logger.warn(
        `${context} ${provider.name} would not vouch for ${bank} receipt ${code} ` +
          `(read from ${source}, answered in ${asked} ms) — the line above says why`
      )

      return {
        attested: false,
        failure: { outcome: ReceiptVerificationOutcome.NOT_REGISTERED, bank, code }
      }
    }

    // Everything on this line is safe to print. The recipient is deliberately
    // absent: masked or whole, it is a stranger's payment credential, and it is
    // the one field of an attested receipt that must never reach a log.
    this.logger.log(
      `${context} ${provider.name} confirms ${code} in ${asked} ms: ` +
        `${lookup.receipt.amountUah} kopecks, currency ${lookup.receipt.currencyCode}, ` +
        `paid ${lookup.receipt.paidAt.toISOString()}`
    )

    return { attested: true, receipt: lookup.receipt, source }
  }

  /**
   * The document inside a signed envelope, or the file as it came.
   *
   * **Here rather than in the callers, and that is a fix rather than a move.**
   * They did it themselves, so the rule lived in more than one place and the
   * facade never saw the envelope at all. That was harmless while every
   * verifier worked from a code, and is not now: monobank's checks the
   * signature *on the envelope*, which the callers had already thrown away by
   * the time they asked.
   *
   * A receipt saved out of a banking app is a PKCS#7 container. Everything
   * downstream that reads text needs the document inside it; the one thing that
   * needs the envelope gets it from {@link ReceiptSubmission.uploaded}.
   */
  private unwrapped(file: ReceiptFile, context: string): ReceiptFile {
    const document = withoutSignatureEnvelope(file)

    if (document !== file) {
      this.logger.log(
        `${context} the upload is a signed container; the document inside it is ` +
          `${document.buffer.byteLength} bytes`
      )
    }

    return document
  }

  /**
   * The bank's own document for a verified receipt, or `null`.
   *
   * Separate from {@link verify} rather than folded into it because they answer
   * to different failures: a receipt that cannot be verified must not be sent
   * anywhere, while a verified receipt whose document cannot be fetched is a
   * proven payment that simply has to be forwarded some other way. A caller
   * that treated the two alike would refuse a user for their bank's downtime.
   */
  async officialDocument(
    receipt: AttestedReceipt,
    context = ANONYMOUS
  ): Promise<ReceiptFile | null> {
    const document = receipt.document

    // Always in hand today, and the method stays because that is a property of
    // the verifiers rather than of the port. PrivatBank downloads the document
    // in order to read it at all; monobank's proof is *about* the uploaded
    // bytes. Neither has anything left to fetch.
    if (document.kind === AttestedDocumentKind.FILE) {
      this.logger.log(
        `${context} the verifier already handed over the document for ${receipt.code}: ` +
          `${document.file.buffer.byteLength} bytes`
      )

      return document.file
    }

    this.logger.warn(`${context} receipt ${receipt.code} verified without a document`)

    return null
  }

  /**
   * The first code any bank's strategy recognises in this file.
   *
   * **The filename is tried first, and on a match nothing is extracted at all.**
   * A receipt downloaded from monobank is called `297X351KC1T2BKMB.pdf`, so the
   * ordinary upload is identified exactly, instantly, and without an optical
   * read that could misread a character — and it still verifies on a day the
   * sidecar is unwell.
   *
   * Strategies are asked in the order the module lists them and the first
   * answer wins. That is safe precisely because each describes its own bank's
   * format strictly — a monobank code is not a valid PrivatBank one — so "first"
   * is "the only one that matched", not a priority nobody wrote down.
   */
  private async readCode(
    file: ReceiptFile,
    document: ReceiptFile,
    context: string
  ): Promise<(ExtractedReceiptCode & { text: string | null }) | null> {
    const named = this.firstMatch((strategy) => strategy.findCodeInFileName(file.fileName))

    if (named !== null) {
      this.logger.log(
        `${context} read ${named.bank} code ${named.code} from the file's own name — ` +
          'no extraction needed'
      )

      // No text was read, and the `null` says so rather than an empty string: a
      // verifier that needs the document's text must be able to tell "nothing
      // was extracted" from "the document is blank".
      return { ...named, source: ReceiptTextSource.FILE_NAME, text: null }
    }

    this.logger.log(
      `${context} the file name names no code this build knows; reading the document itself`
    )

    const readAt = Date.now()
    const extracted = await this.checker.extractText(document).catch((error: unknown) => {
      this.logger.error(`${context} receipt text could not be read: ${describeError(error)}`)

      return null
    })

    if (extracted === null) return null

    // Lengths only, never the text. A receipt states two people's accounts, and
    // a monobank one states the recipient's card unmasked.
    this.logger.log(
      `${context} read ${extracted.text.length} characters by ${extracted.source} ` +
        `in ${Date.now() - readAt} ms`
    )

    const printed = this.firstMatch((strategy) => strategy.findCodeInText(extracted.text))

    if (printed === null) {
      this.logger.warn(
        `${context} no bank strategy recognised a receipt code in those ` +
          `${extracted.text.length} characters`
      )

      return null
    }

    this.logger.log(`${context} read ${printed.bank} code ${printed.code} from the document`)

    return { ...printed, source: extracted.source, text: extracted.text }
  }

  /** The bank and code of the first strategy that recognises something. */
  private firstMatch(
    read: (strategy: ReceiptCodeStrategy) => string | null
  ): Omit<ExtractedReceiptCode, 'source'> | null {
    return this.strategies.reduce<Omit<ExtractedReceiptCode, 'source'> | null>(
      (found, strategy) => {
        if (found !== null) return found
        const code = read(strategy)

        return code === null ? null : { bank: strategy.bank, code }
      },
      null
    )
  }
}
