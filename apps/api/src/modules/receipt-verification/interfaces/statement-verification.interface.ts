import type { BankProvider, SaleStatementRejection } from '@transacto/contracts'
import type { ParsedStatement } from 'src/shared/interfaces'
import type { ReceiptFile } from 'src/shared/interfaces'

/**
 * Proving a bank statement, which is a different problem from proving a receipt.
 *
 * A receipt is asked whether one payment happened. A statement is asked whether
 * one **did not** — and a negative is only as good as the document's coverage,
 * so a statement that cannot be shown to be the bank's, to be for this account,
 * to span the whole window and to have been read in full proves nothing at all.
 * Every refusal below is one of those four failing.
 *
 * **The two banks are proven in completely different ways, and neither is a
 * fallback for the other.** Monobank's statement is verified by the qualified
 * signature on the bytes the user uploaded; PrivatBank's is verified by asking
 * PrivatBank whether the document number exists and reading **their** copy,
 * which is stronger still because the upload stops being evidence at all.
 * Mirrors the receipt path's own split, for the same reason.
 */

/** What the user handed over, and who is supposed to have signed it. */
export interface StatementSubmission {
  readonly bank: BankProvider
  /**
   * Exactly what was uploaded — the signed envelope, if it was one.
   *
   * **Unmodified, and that is load-bearing** on the monobank path: a signature
   * is over these precise bytes, and anything that unwrapped them first would
   * be handing the verifier a document it must refuse.
   */
  readonly uploaded: ReceiptFile
}

/**
 * A statement this product is now willing to read.
 *
 * `document` is what the text is extracted from, and it is not always what was
 * uploaded: on the PrivatBank path it is the copy the bank served, and the
 * upload is discarded the moment its number has been read out of it.
 */
export interface AttestedStatement {
  readonly bank: BankProvider
  readonly document: ReceiptFile
}

/** Why a document could not be attested at all. */
export interface StatementNotAttested {
  readonly rejection: SaleStatementRejection
}

/**
 * What {@link StatementVerificationProvider.attest} answers.
 *
 * A discriminated pair rather than a thrown error, and this codebase's rule
 * against custom error classes is only half the reason. The other half is that
 * the union does the job better: `document` does not exist on the refusal
 * branch, so a caller **cannot** read past a refusal — where a thrown error
 * relies on somebody having written the `catch`.
 */
export type StatementAttestation = AttestedStatement | StatementNotAttested

/** Whether a document was attested at all. */
export const isAttested = (
  attestation: StatementAttestation
): attestation is AttestedStatement => 'document' in attestation

/**
 * One service that can vouch for one bank's statements.
 *
 * Injected as an array under `STATEMENT_VERIFICATION_PROVIDERS`, in the manner
 * of `RECEIPT_VERIFICATION_PROVIDERS`, so the facade iterates what it is handed
 * and names no bank and no verifier.
 */
export interface StatementVerificationProvider {
  /** For the log line — the host doing the vouching, not our class. */
  readonly name: string
  supports(bank: BankProvider): boolean
  /**
   * The document, once it is the bank's rather than the uploader's — or why not.
   *
   * A provider never decides whether the money arrived. That is the facade's
   * question, asked only of a document this has already established is genuine.
   */
  attest(submission: StatementSubmission): Promise<StatementAttestation>
}

/** What a statement is being asked about. */
export interface StatementExpectation {
  /** The last four digits of the card the sale pays out to. */
  readonly cardTail: string
  /** The credit that is supposed to be missing, in UAH kopecks. */
  readonly amountKopecks: number
  /** The window the credit would have landed in. */
  readonly from: Date
  readonly to: Date
}

/** What a statement turned out to say. */
export enum StatementFinding {
  /**
   * The credit is there. The seller denied money they received, and the order
   * is settled on the document rather than on their word.
   */
  CREDITED = 'CREDITED',
  /**
   * The document covers the window, was read in full, and holds no such credit.
   * The denial stands.
   */
  NOT_CREDITED = 'NOT_CREDITED'
}

/**
 * A statement's verdict, or why it has none.
 *
 * A discriminated pair rather than an outcome enum with a nullable reason: a
 * finding and a rejection are not two values of one thing, and a caller that
 * could read one as the other would settle an order on a document that was
 * refused.
 */
export interface StatementFound {
  readonly finding: StatementFinding
  /** Always present: a finding is only reachable from a document that was read. */
  readonly statement: ParsedStatement
}

export interface StatementRejected {
  readonly rejection: SaleStatementRejection
  /**
   * The document, when one was read far enough to be refused on its contents.
   *
   * `null` when the refusal came earlier — nothing vouched for it, or it did not
   * parse at all. An operator still has the file either way; this is only what
   * could be recorded beside it.
   */
  readonly statement: ParsedStatement | null
}

export type StatementVerification = StatementFound | StatementRejected

/**
 * Whether a verification reached a finding at all.
 *
 * Named members rather than inline object types, so this narrows in both
 * directions — a caller writing `isStatementFinding(x) ? … : x.rejection` needs
 * the negative branch to be a type, not a shape TypeScript re-derives.
 */
export const isStatementFinding = (
  verification: StatementVerification
): verification is StatementFound => 'finding' in verification
