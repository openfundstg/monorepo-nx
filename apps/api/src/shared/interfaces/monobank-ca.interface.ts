/**
 * `ca.monobank.ua` — monobank's own signature verification service.
 *
 * **What it answers is not "did this payment happen" but "is this file the
 * bank's".** It takes the signed container a receipt is distributed as, checks
 * the qualified electronic signature on it, and reports who signed, when, and
 * whether the bytes still match. The payment itself — the sum, the recipient,
 * the moment — is inside the document and is read from there.
 *
 * That is a stronger claim than the lookup it replaced. `check.gov.ua` said "a
 * payment with this code exists, here are its details", which is a search in
 * somebody's index; this says "these exact bytes were signed by the bank and
 * have not been altered since", which defeats a forgery directly. A single
 * flipped bit is refused — verified, not assumed.
 *
 * **Captured 2026-09-08** from `https://ca.monobank.ua/verify/`, against a real
 * receipt, its one-bit-altered copy, and the unsigned PDF from inside it. Every
 * field below was present in those responses; nothing here is inferred.
 *
 * Three things about it are worth knowing before touching this file:
 *
 * - **There is no captcha.** Their page sends an `x-captcha` header; the
 *   endpoint answers `200` without it. Verified deliberately, because the
 *   alternative — a browser, a token, a reCAPTCHA score — is exactly the
 *   machinery this replaced.
 * - **A refusal is a `200`.** A file whose signature does not check out comes
 *   back with `signatureValid: false`, not an error status. Only a body that is
 *   not a signed container at all is a `4xx`. Reading the status alone would
 *   record a forgery as a success.
 * - **`signingTime` is not the payment time.** It is when the document was
 *   produced. The same payment yields several validly signed documents with
 *   different signing times — observed: one at `12:15:44Z` saved by the payer,
 *   another at `16:58:38Z` fetched later for the same transfer. Anything that
 *   needs the moment of payment reads it from the document.
 */

/** Their endpoint's request. */
export interface MonobankCaVerifyRequest {
  /**
   * Base64 of whole signed containers — DER PKCS#7/CAdES, exactly as the bank
   * distributes them and exactly as a user saves them.
   *
   * An array because that is what they accept; this product sends one. Sending
   * several is untested and the response's `signatures` array is per *file*
   * inside one protocol, not per element here.
   */
  readonly files: readonly string[]
}

/** Their answer when the body was a signed container, valid or not. */
export interface MonobankCaVerifyResponse {
  /** The verdict, repeated from {@link MonobankCaProtocolInfo.signatureValid}. */
  readonly signatureValid: boolean
  readonly protocolInfo: MonobankCaProtocolInfo
  /** A human-readable PDF protocol of the check. Not fetched by this product. */
  readonly protocolFileUrl: string
  /** The full ETSI EN 319 102 report, base64 XML. Tens of kilobytes. */
  readonly validationReportXml: string
}

export interface MonobankCaProtocolInfo {
  readonly signatureValid: boolean
  /** `urn:etsi:019102:mainindication:total-passed` on success. */
  readonly mainIndication: string
  /** Whether the signature was detached from its document. Ours never is. */
  readonly detachedMode: boolean
  readonly verifiedAt: string
  /** `urn:etsi:019102:validationprocess:Basic`. */
  readonly validationProcess: string
  /**
   * One entry per signature on the document.
   *
   * A bank receipt carries exactly one. Declared as an array because that is
   * what arrives, and read as one rather than assumed: a document with no
   * signatures would otherwise pass every check by having nothing to fail.
   */
  readonly signatures: readonly MonobankCaSignature[]
}

export interface MonobankCaSignature {
  readonly valid: boolean
  readonly mainIndication: string
  /** The timestamp authority's verdict — `VALID` when the time is attested. */
  readonly tspStatus: string
  /** When the document was produced. **Not** when the payment happened. */
  readonly signingTime: string
  readonly tspTime: string
  readonly bestSignatureTime: string
  /** `ГОСТ 34.311-95` — DSTU's hash, which `openssl` cannot verify. */
  readonly hashAlgorithm: string
  readonly signAlgorithm: string
  /** The document's digest, hex. */
  readonly fileHashHex: string
  /** `CAdES-BES`. */
  readonly signatureFormat: string
  /** `Кваліфікований` for a qualified signature. */
  readonly signType: string
  readonly signerCert: MonobankCaCertificate
  /** Signer, intermediate, root — the last carries `selfSigned`. */
  readonly certChain: readonly MonobankCaChainLink[]
}

export interface MonobankCaCertificate {
  /** The individual who holds the key — a bank employee, and it changes. */
  readonly commonName: string
  /** The legal entity. **This is what identifies the bank**, not the person. */
  readonly organization: string
  readonly serialNumber: string
  /** The issuing authority — monobank's own KNEDP. */
  readonly issuer: string
  readonly notBefore: string
  readonly notAfter: string
  readonly signatureAlgorithm: string
}

export interface MonobankCaChainLink {
  readonly commonName: string
  readonly serialNumber: string
  readonly issuer: string
  /** Present and `true` on the root only. */
  readonly selfSigned?: boolean
}

/** Their answer when the body was not a signed container at all — an HTTP 400. */
export interface MonobankCaError {
  /** `BAD_REQUEST`. */
  readonly errCode: string
  /** `file is not a valid CMS signature`. Developer-facing, never shown. */
  readonly errText: string
}

/** One identity a receipt may be signed under, as the certificate states it. */
export interface MonobankSignerIdentity {
  /** `signerCert.organization` — the legal entity, not the person. */
  readonly organization: string
  /** `signerCert.issuer` — the qualified provider that vouched for them. */
  readonly issuer: string
}

/**
 * Who has to have signed a receipt for it to be monobank's.
 *
 * **`signatureValid` alone proves nothing about the bank.** A qualified
 * signature is available to anyone who buys one, so a forger can sign their own
 * invented receipt and the service will confirm — truthfully — that the
 * signature is valid. What makes the document a *bank* document is the identity
 * behind it, and that is checked here.
 *
 * The individual named in `commonName` changes with whoever holds the key, so
 * it is deliberately not part of the test.
 *
 * **A list, because the bank changed certificate under us.** Until 9 Sep 2026
 * every receipt was signed as `АТ «УНІВЕРСАЛ БАНК»` under monobank's own KNEDP;
 * from the 10th they arrive signed as `АКЦІОНЕРНЕ ТОВАРИСТВО "УНІВЕРСАЛ БАНК"`
 * under the state provider Diia — the same operational director, the same tax
 * number, a different issuer and the organisation written in full legal form.
 * A single pair meant every genuine receipt from that morning on was refused,
 * and logged as a probable forgery.
 *
 * **And a list because it is not a rotation.** The two Diia entries below are
 * two certificates monobank holds *at the same time*, and which one signs a
 * given document is not ours to predict. Read out of the containers
 * themselves on 2026-09-21:
 *
 * | `O=` | valid | observed on |
 * | --- | --- | --- |
 * | `АКЦІОНЕРНЕ ТОВАРИСТВО "УНІВЕРСАЛ БАНК"` | 2026-02-27 → 2028-02-27 | a statement signed 18 Sep |
 * | `АКЦІОНЕРНЕ ТОВАРИСТВО УНІВЕРСАЛ БАНК` | 2025-12-19 → 2027-12-19 | a receipt signed 21 Sep |
 *
 * The difference is **two bytes** — the `"` around the trading name — and
 * everything else about the two certificates agrees: same issuer, same officer,
 * same tax number. So the missing entry did not fail a day's receipts and stop;
 * it failed roughly every other one, at random, for as long as both certificates
 * are current. One genuine ₴684 top-up was refused as `UNVERIFIED`, went to
 * review, and was settled by hand in the panel seven minutes later.
 *
 * The lesson for the next entry: **do not assume the newest certificate replaced
 * the previous one.** Add the pair and leave the others, exactly as here.
 *
 * **Pairs, never two independent lists.** Accepting any of these organisations
 * under any of these issuers would be a wider claim than the evidence: what has
 * been observed is *this* bank under *that* provider. And the issuer half can
 * never be relaxed to "some qualified provider", because that is precisely the
 * forgery laundry the whole check exists to prevent — anyone can obtain a
 * qualified certificate, and only a provider's own vetting connects a
 * certificate to the legal entity it names.
 *
 * The same reasoning forbids tidying the two spellings into one by stripping
 * quotation marks before comparing. A normaliser accepts everything it was
 * never shown, and `АКЦІОНЕРНЕ "ТОВАРИСТВО" УНІВЕРСАЛ БАНК` is a certificate
 * somebody can buy. What is accepted is what has been observed, spelled the way
 * the certificate spells it.
 *
 * When monobank rotates again this list is what to extend, and the error line in
 * `MonobankSignatureAdapterService` prints exactly the pair to add.
 */
export const MONOBANK_SIGNERS: readonly MonobankSignerIdentity[] = [
  { organization: 'АТ «УНІВЕРСАЛ БАНК»', issuer: 'КНЕДП monobank | Universal Bank' },
  {
    organization: 'АКЦІОНЕРНЕ ТОВАРИСТВО "УНІВЕРСАЛ БАНК"',
    issuer: '"Дія". Кваліфікований надавач електронних довірчих послуг'
  },
  {
    organization: 'АКЦІОНЕРНЕ ТОВАРИСТВО УНІВЕРСАЛ БАНК',
    issuer: '"Дія". Кваліфікований надавач електронних довірчих послуг'
  }
]

/** The indication that means every check passed. */
export const MONOBANK_CA_TOTAL_PASSED = 'urn:etsi:019102:mainindication:total-passed'
