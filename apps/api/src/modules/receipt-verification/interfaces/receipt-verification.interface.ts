import type { BankProvider } from '@transacto/contracts'
import type { ReceiptFile } from 'src/shared/interfaces'
import type {
  AttestedDocumentKind,
  ReceiptLookupResult,
  ReceiptMismatch,
  ReceiptTextSource,
  ReceiptVerificationOutcome
} from 'src/modules/receipt-verification/enums'

/**
 * What a verifier says a receipt is.
 *
 * Everything on it is the verifier's word, not ours and not the uploader's —
 * which is the whole value of it. Nothing here has been matched against a
 * payout yet; that is {@link ReceiptExpectation}'s job.
 */
export interface AttestedReceipt {
  readonly bank: BankProvider
  /** The code as the verifier was asked, dashes included. */
  readonly code: string
  /** UAH kopecks. */
  readonly amountUah: number
  readonly paidAt: Date
  /** ISO 4217 numeric — `980` is the hryvnia. */
  readonly currencyCode: number
  /**
   * The recipient, as the receipt states them.
   *
   * Both banks state it in full today — monobank prints the recipient's card
   * unmasked, PrivatBank names their card or their IBAN — and a masked form is
   * still accepted, because a mask makes the check probabilistic rather than
   * impossible. That is a difference in strength, not in kind.
   *
   * **Never log this.** Masked or not, it is a stranger's payment credential.
   */
  readonly recipient: string
  /**
   * The bank's own document — a link to fetch, the bytes themselves, or neither.
   *
   * Two shapes because the two verifiers hand it over differently, and the
   * difference is not cosmetic. `check.gov.ua` publishes a bearer URL that
   * anybody can fetch, so it travels as a link and is downloaded later.
   * PrivatBank issues a token bound to the session that asked, usable once and
   * from nowhere else — so by the time that provider can say the receipt is
   * real, it is already holding the PDF, and a URL would be a link this process
   * could not follow twice.
   *
   * A consumer wants the document and not the difference: ask the facade for
   * {@link ReceiptVerificationFacadeService.officialDocument}, which resolves
   * whichever of the two arrived.
   */
  readonly document: AttestedDocument
}

/**
 * Where a verified receipt's own document is, if it is anywhere.
 *
 * **A link used to be one of these and is not any more.** `check.gov.ua`
 * published a bearer URL that anything holding it could fetch; both verifiers
 * left are already holding the bytes by the time they can vouch at all —
 * PrivatBank because its download token dies with the session that asked, and
 * monobank because the signature it checked was on the file itself.
 */
export type AttestedDocument =
  /** Already in hand, because it could not have been proven otherwise. */
  | { readonly kind: AttestedDocumentKind.FILE; readonly file: ReceiptFile }
  /** The verifier vouched for the receipt and published no document. */
  | { readonly kind: AttestedDocumentKind.NONE }

/**
 * What this top-up requires of a receipt.
 *
 * Built from the reserved payout, never from the file: the point of the check
 * is that the two are compared, and an expectation read off the same upload it
 * validates would agree with itself every time.
 */
export interface ReceiptExpectation {
  /**
   * UAH kopecks the receipt must state — the payout's **outstanding** amount,
   * not its full one.
   *
   * They are the same figure for the ordinary top-up, which is settled by one
   * transfer. They differ once a receipt has been accepted against the payout,
   * and using the full amount there would refuse the second half of a payment
   * the product itself invited by counting coverage.
   */
  readonly amountUah: number
  /** The payout's recipient card, digits only. Never logged. */
  readonly recipientCard: string
  /**
   * The moment the payout was reserved. Nothing paid before it can be for it.
   *
   * Compared at the minute, not the second — a receipt states only `HH:mm`, so
   * the two are read at the resolution both of them have. See `timingMismatch`.
   */
  readonly paidNotBefore: Date
  /** The pay window's close. Compared exactly; the reason is with the check. */
  readonly paidNotAfter: Date
}

/**
 * The verdict on one receipt.
 *
 * A discriminated union rather than a result with nullable fields, so a caller
 * that forgets a case does not compile. Each failure carries exactly what an
 * operator would need and nothing that would be unsafe in a log.
 */
export type ReceiptVerification =
  | {
      readonly outcome: ReceiptVerificationOutcome.VERIFIED
      readonly receipt: AttestedReceipt
      readonly source: ReceiptTextSource
    }
  /**
   * Everything checked except the recipient, which could not be checked at all.
   *
   * Carries the same payload as {@link ReceiptVerificationOutcome.VERIFIED} —
   * the receipt is real and its document is fetchable — so a caller that
   * decides to accept it has everything it needs, and one that decides not to
   * is refusing on the outcome rather than on a missing field.
   */
  | {
      readonly outcome: ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
      readonly receipt: AttestedReceipt
      readonly source: ReceiptTextSource
    }
  | { readonly outcome: ReceiptVerificationOutcome.CODE_NOT_FOUND }
  | {
      readonly outcome: ReceiptVerificationOutcome.NOT_REGISTERED
      readonly bank: BankProvider
      readonly code: string
    }
  | {
      readonly outcome: ReceiptVerificationOutcome.MISMATCHED
      readonly bank: BankProvider
      readonly code: string
      readonly reasons: readonly ReceiptMismatch[]
    }
  | { readonly outcome: ReceiptVerificationOutcome.UNAVAILABLE; readonly reason: string }

/** What one provider answered about one code. */
export type ReceiptLookup =
  | { readonly result: ReceiptLookupResult.FOUND; readonly receipt: AttestedReceipt }
  | { readonly result: ReceiptLookupResult.UNKNOWN }
  | { readonly result: ReceiptLookupResult.UNAVAILABLE; readonly reason: string }

/**
 * A code read out of an uploaded file, and where it was read from.
 *
 * The source travels with the code because the three are not equally
 * trustworthy — a PDF's text layer is exact, optical recognition is a guess —
 * and a receipt refused after an OCR read deserves a different line in the log
 * from one refused after an exact one.
 */
export interface ExtractedReceiptCode {
  readonly bank: BankProvider
  readonly code: string
  readonly source: ReceiptTextSource
}

/**
 * **The Strategy.** One bank's knowledge of what its own receipt code looks like.
 *
 * Nothing else in this module knows that a monobank code is four groups of four
 * alphanumerics while a PrivatBank one is sixteen digits, and that is the point:
 * adding PrivatBank is a new class listed in the module, not a branch in a
 * reader. A strategy is deliberately *not* told which verifier will be asked —
 * it describes a bank, and the vocabulary any one service files that bank under
 * belongs to the adapter for that service.
 */
export interface ReceiptCodeStrategy {
  readonly bank: BankProvider
  /**
   * The code this bank names its own downloads after, or `null`.
   *
   * Separate from {@link findCodeInText} because it is a different quality of
   * evidence, not a different place to look. Monobank serves a receipt as
   * `297X351KC1T2BKMB.pdf` — the code itself — and a filename needs no
   * recognition to be right, so a match here skips extraction altogether and is
   * recorded as {@link ReceiptTextSource.FILE_NAME} rather than being credited
   * to an optical read that never happened.
   */
  findCodeInFileName(fileName: string): string | null
  /** The code printed on the receipt, read out of its text, or `null`. */
  findCodeInText(text: string): string | null
}

/**
 * One upload, and everything already established about it.
 *
 * A parameter object rather than a widening argument list, and that is the
 * point of it: the two verifiers need different halves. PrivatBank needs only
 * the code, because it fetches its own copy of the document; monobank needs the
 * **bytes the user uploaded**, because what it verifies is the signature on
 * them. A third verifier will want some other combination, and it should be
 * able to take it without every existing implementation changing shape.
 */
export interface ReceiptSubmission {
  readonly bank: BankProvider
  /** The code, as the strategy read it. */
  readonly code: string
  /**
   * Exactly what the user uploaded — the signed envelope, if it was one.
   *
   * **Unmodified, and that is load-bearing.** A signature is over these precise
   * bytes; anything that unwrapped, re-encoded or normalised them first would
   * hand the verifier a document it must refuse.
   */
  readonly uploaded: ReceiptFile
  /** The same document with any signature envelope removed — what text is read from. */
  readonly document: ReceiptFile
  /**
   * Text already read from {@link document}, or `null`.
   *
   * `null` when the code came from the file's own name and nothing was
   * extracted. A provider that needs the text asks for it rather than assuming
   * it is here — the shortcut exists to save an optical read, not to promise
   * one never happened.
   */
  readonly text: string | null
}

/**
 * **The Adapter's port.** Somewhere that can vouch for a receipt.
 *
 * Two implementations, and they have almost nothing in common underneath —
 * which is the argument for the port rather than against it. `PrivatbankAdapter`
 * asks PrivatBank whether a code exists and downloads the document to read it.
 * `MonobankSignatureAdapter` asks monobank's certification service whether the
 * signature on the uploaded file is the bank's, and reads the document it has
 * just proven. One is a lookup, the other is a proof; neither fact has ever had
 * to reach the facade.
 *
 * The port exists so that the facade never learns that a sum arrives in
 * kopecks, that a missing key is how one service spells "no such receipt", or
 * that a qualified signature has to be checked against a signer's organisation.
 */
export interface ReceiptVerificationProvider {
  /** For log lines. Never shown to a user. */
  readonly name: string
  /** Whether this provider can answer for this bank at all. */
  supports(bank: BankProvider): boolean
  /** What this provider will say about the upload — never throws for a bad receipt. */
  vouchFor(submission: ReceiptSubmission): Promise<ReceiptLookup>
}

/**
 * What {@link ReceiptVerificationFacadeService.attest} established, before any
 * payout is brought into it.
 *
 * Two shapes rather than a nullable receipt, so that a caller which cannot
 * proceed is handed the finished verdict to record instead of being left to
 * invent one. `verify` returns that verdict directly.
 */
export type ReceiptAttestation =
  | {
      readonly attested: true
      readonly receipt: AttestedReceipt
      readonly source: ReceiptTextSource
    }
  | { readonly attested: false; readonly failure: ReceiptAttestationFailure }

/**
 * The verdicts `attest` can reach on its own.
 *
 * Narrower than {@link ReceiptVerification} by exactly the three that require a
 * payout: nothing is matched before a payout is named, so `MISMATCHED` and both
 * verified outcomes are unreachable here. Stating that in the type is what lets
 * a caller map the rest exhaustively instead of carrying branches for endings
 * that cannot happen.
 */
export type ReceiptAttestationFailure = Extract<
  ReceiptVerification,
  {
    readonly outcome:
      | ReceiptVerificationOutcome.CODE_NOT_FOUND
      | ReceiptVerificationOutcome.NOT_REGISTERED
      | ReceiptVerificationOutcome.UNAVAILABLE
  }
>
