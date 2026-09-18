import {
  MONOBANK_CA_TOTAL_PASSED,
  MONOBANK_SIGNERS,
  type MonobankCaSignature,
  type MonobankCaVerifyResponse
} from 'src/shared/interfaces'

/**
 * Why a document did not verify, when it did not.
 *
 * Two outcomes rather than one, because they mean opposite things about the
 * person who uploaded it. A signature that does not hold is a broken or edited
 * file; a signature that holds for **somebody other than the bank** is what a
 * document signed with a certificate its author bought looks like, and a
 * qualified certificate can be bought by anybody.
 */
export enum SignatureRefusal {
  /** No valid signature at all, or the overall verdict was not total-passed. */
  INVALID = 'INVALID',
  /** Valid, and by nobody this build recognises as the bank. */
  NOT_THE_BANK = 'NOT_THE_BANK'
}

export type BankSignature =
  | { readonly signature: MonobankCaSignature }
  | { readonly refusal: SignatureRefusal }

/**
 * The bank's own valid signature on a monobank document, or why there is none.
 *
 * Searched rather than taken from `signatures[0]`, so a document that is
 * counter-signed by somebody else still verifies on the bank's own. The overall
 * verdict is checked too: it is `false` the moment any signature on the document
 * fails, and a document carrying a broken signature is not one to settle money
 * against however good the other one is.
 *
 * **Shared by the receipt path and the statement path**, which ask the same
 * question of the same certification service about two different documents. It
 * is pure so that each caller keeps its own logging — the receipt names a code,
 * the statement names a sale — while neither owns a second copy of the rule
 * that decides whether monobank signed something.
 */
export const bankSignatureOf = (answer: MonobankCaVerifyResponse): BankSignature => {
  const { signatureValid, protocolInfo } = answer

  if (!signatureValid || protocolInfo.mainIndication !== MONOBANK_CA_TOTAL_PASSED)
    return { refusal: SignatureRefusal.INVALID }

  const banks = protocolInfo.signatures.find(
    (candidate) =>
      candidate.valid &&
      MONOBANK_SIGNERS.some(
        (signer) =>
          candidate.signerCert.organization === signer.organization &&
          candidate.signerCert.issuer === signer.issuer
      )
  )

  return banks === undefined ? { refusal: SignatureRefusal.NOT_THE_BANK } : { signature: banks }
}

/** Who actually signed it, for the log line that follows a refusal. */
export const describeSigners = (answer: MonobankCaVerifyResponse): string =>
  answer.protocolInfo.signatures
    .map((entry) => `${entry.signerCert.organization} via ${entry.signerCert.issuer}`)
    .join('; ')
