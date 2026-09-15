import { Injectable, Logger } from '@nestjs/common'
import { BankProvider } from '@transacto/contracts'
import {
  AttestedDocumentKind,
  ReceiptLookupResult
} from 'src/modules/receipt-verification/enums'
import type {
  ReceiptLookup,
  ReceiptSubmission,
  ReceiptVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import { PrivatbankDocumentApiService } from 'src/modules/receipt-verification/services/privatbank-document.api.service'
import { ReceiptCheckerApiService } from 'src/modules/receipt-verification/services/receipt-checker.api.service'
import { parsePrivatbankReceipt } from 'src/modules/receipt-verification/utils'
import {
  PrivatbankDocumentType,
  PrivatbankRecipientKind,
  type ReceiptFile
} from 'src/shared/interfaces'
import { UAH_CURRENCY_CODE } from 'src/shared/constants'
import { describeError } from 'src/shared/utils'

/**
 * **The Adapter — PrivatBank.** Their own document service behind this
 * product's verification port.
 *
 * It answers the same three-outcome question as monobank's adapter and does
 * entirely different work to answer it, which is the reason the port exists.
 * Monobank's proves the *file* by its signature; this one cannot — PrivatBank
 * distributes a plain PDF with nothing to check — so it proves the **code**
 * instead, and then fetches PrivatBank's own copy rather than trusting the
 * upload. The sum, the recipient's account and the moment of payment are inside
 * that PDF, so it downloads, reads, and hands back the same
 * {@link AttestedReceipt} the other one does.
 *
 * Three consequences worth stating, because they are not obvious from the
 * outside:
 *
 * - **It downloads before it can vouch**, so the document travels back as bytes
 *   rather than as a link. Their token is bound to the session that asked and
 *   dies with it; a URL handed upward would be one this process could not
 *   follow a second time.
 * - **It trusts nothing the user uploaded.** The document it reads is the one
 *   PrivatBank served for that code, which is what makes a screenshot useless
 *   as a forgery here: the upload only has to name a real code.
 * - **It reads a layout, and a layout changes silently.** Everything the parser
 *   cannot find with certainty is a refusal, logged at error, never a default.
 *   A receipt refused this way reaches an operator; a receipt accepted on a
 *   half-read layout would settle a payout against the wrong number.
 */
@Injectable()
export class PrivatbankAdapterService implements ReceiptVerificationProvider {
  readonly name = 'privatbank.ua'

  private readonly logger = new Logger(PrivatbankAdapterService.name)

  constructor(
    private readonly documents: PrivatbankDocumentApiService,
    private readonly checker: ReceiptCheckerApiService
  ) {}

  /**
   * PrivatBank and nothing else — this is their own service, not a registry.
   *
   * It needs the text extractor as well as PrivatBank, because a document it
   * cannot read is a document it cannot vouch for.
   */
  supports(bank: BankProvider): boolean {
    return bank === BankProvider.PRIVAT && this.checker.isConfigured
  }

  /**
   * Only the code is used, and the rest of the submission is ignored on
   * purpose: this verifier fetches its own copy of the document rather than
   * trusting the one that was uploaded. What the user sent is evidence they
   * hold a receipt; what PrivatBank serves is the receipt.
   */
  async vouchFor({ bank, code }: ReceiptSubmission): Promise<ReceiptLookup> {
    if (!this.supports(bank))
      return {
        result: ReceiptLookupResult.UNAVAILABLE,
        reason: `${bank} is not a bank this verifier answers for`
      }

    const found = await this.documents
      .findDocument(PrivatbankDocumentType.RECEIPT, code)
      .catch((error: unknown) => {
        this.logger.error(`PrivatBank did not answer a lookup: ${describeError(error)}`)

        return null
      })

    if (found === null)
      return { result: ReceiptLookupResult.UNAVAILABLE, reason: 'PrivatBank is unreachable' }

    this.logger.log(
      `privatbank.ua answered for ${code}: status ${found.body.status}, ` +
        `document "${found.body.document_name ?? 'none'}", ` +
        `session ${found.cookie === '' ? 'absent' : 'issued'}`
    )

    // `status: false` is their negative, and it is an explicit boolean. An
    // empty or malformed code lands here too: their lookup does not validate,
    // so a code that never existed and one that was mistyped are the same
    // reply.
    if (found.body.status !== true) {
      this.logger.warn(`PrivatBank does not know receipt ${code}: ${found.body.reason ?? 'no reason'}`)

      return { result: ReceiptLookupResult.UNKNOWN }
    }

    const token = found.body.token
    if (token === undefined || found.cookie === '') {
      // Their own success reply carries both. Missing either means the shape
      // moved, and it is worth an error line rather than a quiet refusal.
      this.logger.error(
        `PrivatBank found receipt ${code} and issued no usable grant ` +
          `(token: ${token === undefined ? 'absent' : 'present'}, session: ` +
          `${found.cookie === '' ? 'absent' : 'present'})`
      )

      return { result: ReceiptLookupResult.UNAVAILABLE, reason: 'no download grant was issued' }
    }

    return this.read(code, { token, cookie: found.cookie, session: found.session })
  }

  /**
   * Downloads the document and reads the three facts a payout is matched by.
   *
   * A failure anywhere here is `UNAVAILABLE`, never `UNKNOWN`: PrivatBank has
   * already said the receipt is real, and reporting "no such receipt" because
   * *we* could not read their PDF would refuse a user for our own problem.
   */
  private async read(
    code: string,
    grant: { token: string; cookie: string; session: string }
  ): Promise<ReceiptLookup> {
    const document = await this.documents
      .downloadReceipt(code, grant)
      .catch((error: unknown) => {
        this.logger.error(`PrivatBank receipt ${code} could not be downloaded: ${describeError(error)}`)

        return null
      })

    if (document === null)
      return { result: ReceiptLookupResult.UNAVAILABLE, reason: 'the document could not be fetched' }

    this.logger.log(
      `privatbank.ua served ${document.buffer.byteLength} bytes for ${code}; reading it`
    )

    const fields = await this.parse(code, document)

    if (fields === null)
      return {
        result: ReceiptLookupResult.UNAVAILABLE,
        reason: 'the document could not be read'
      }

    // The recipient's *kind* is safe to print and is the interesting half: it is
    // what decides whether the strongest of the four checks can run at all. Its
    // value — a card in full, or an IBAN — never appears in a log.
    this.logger.log(
      `read ${code}: ${fields.amountUah} kopecks, paid ${fields.paidAt.toISOString()}, ` +
        `recipient stated as ${fields.recipient.kind}`
    )

    return {
      result: ReceiptLookupResult.FOUND,
      receipt: {
        bank: BankProvider.PRIVAT,
        code,
        amountUah: fields.amountUah,
        paidAt: fields.paidAt,
        // PrivatBank pays in hryvnia and its receipt states no currency code of
        // its own. Declared here rather than left absent, because the matching
        // rules treat a missing currency as a mismatch — correctly, since a bare
        // number compared against a payout is how ₴500 gets settled by $500.
        currencyCode: UAH_CURRENCY_CODE,
        // Whatever the receipt named — a card in full, or an IBAN when the
        // money stayed inside PrivatBank. An IBAN cannot be compared with a
        // payout's card at all, and the matching rules refuse it by name rather
        // than this adapter deciding here. Either way a payment credential:
        // never logged, only compared.
        recipient:
          fields.recipient.kind === PrivatbankRecipientKind.CARD
            ? fields.recipient.card
            : fields.recipient.iban,
        // Already in hand. See the class comment: their grant cannot be spent
        // twice, so a link would be one nothing could follow.
        document: { kind: AttestedDocumentKind.FILE, file: document }
      }
    }
  }

  /** The receipt's own text, read in the sandbox, then parsed. */
  private async parse(code: string, document: ReceiptFile) {
    const extracted = await this.checker.extractText(document).catch((error: unknown) => {
      this.logger.error(`PrivatBank receipt ${code} could not be extracted: ${describeError(error)}`)

      return null
    })

    if (extracted === null) return null

    const fields = parsePrivatbankReceipt(extracted.text)

    if (fields === null) {
      // Error, not warning. PrivatBank vouched for this document, so a document
      // we cannot read is our parser meeting a layout it does not know — which
      // is invisible from the outside and stops every PrivatBank top-up until
      // somebody looks.
      this.logger.error(
        `PrivatBank receipt ${code} yielded ${extracted.text.length} characters this build ` +
          'cannot read as a receipt — their layout has changed'
      )
    }

    return fields
  }
}

