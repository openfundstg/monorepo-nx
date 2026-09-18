/**
 * PrivatBank's own document lookup — `privatbank.ua/check`.
 *
 * A different arrangement from monobank's, and the difference decides the whole
 * design of the provider above it. Monobank is verified through the *state*
 * service, which answers with the payment as JSON. PrivatBank is verified
 * through **PrivatBank**, which answers only "a document with this code
 * exists", hands over a token, and puts everything that matters — the sum, the
 * recipient's account, the date — inside the PDF.
 *
 * So the two providers do genuinely different work: one reads a payload, the
 * other reads a document. That is why this is a second `ReceiptVerificationProvider`
 * rather than another entry in the `check.gov.ua` adapter's company map.
 *
 * **Where these shapes come from.** No specification and no published API. Every
 * shape below was captured against the live endpoint on 2026-09-07, including
 * the four failures, which were provoked deliberately — an unknown code, a
 * malformed code, an empty code and an unsupported type.
 *
 * Four things are load-bearing:
 *
 * - **There is no captcha and no WAF challenge.** A clean session with no
 *   cookies and no `aws-waf-token` is answered normally, which is why this path
 *   runs as a plain request through the proxy pool and needs no browser. It is
 *   the one part of receipt verification that does not go near
 *   `apps/receipt-checker`.
 * - **The token is bound to the `PHPSESSID` the same response set.** Presenting
 *   it without that cookie answers `500` with an HTML page — verified against a
 *   token issued to another session. Both must be carried together.
 * - **`status: false` is the negative answer**, and unlike `check.gov.ua` it is
 *   an explicit boolean rather than a missing key. An empty code answers "not
 *   found" rather than a validation error, so nothing here validates a code:
 *   the strategy's pattern is the only gate.
 * - **A request with no parameters at all answers HTML, not JSON.** Any reader
 *   must survive a body that does not parse.
 */

/**
 * The document kinds this product asks for. Others answer "not supported".
 *
 * **The value is the whole vocabulary**: it is the `document[type]` of the
 * lookup, the path segment of the download (`/pb/get-doc/download/statement/…`)
 * and the prefix of the name the bank gives the file
 * (`statement-QB00000000000000.pdf`). One string in three places, which is why
 * the download takes the type rather than hard-coding a segment.
 */
export const PrivatbankDocumentType = {
  RECEIPT: 'receipt',
  /**
   * «Довідка/виписка» — a statement, captured 2026-09-17.
   *
   * What makes this member worth more than a second document kind: it means a
   * PrivatBank statement never has to be trusted as an upload. The bank is
   * asked whether the number exists and then serves **its own copy**, which is
   * the same arrangement the receipt path already has and a stronger claim than
   * any signature check on a file a user sent us.
   */
  STATEMENT: 'statement'
} as const
export type PrivatbankDocumentType =
  (typeof PrivatbankDocumentType)[keyof typeof PrivatbankDocumentType]

/**
 * The form body, urlencoded: `document[type]=receipt&document[id]=P24A…`.
 *
 * Declared as the nested shape their PHP expects rather than as the flat pair,
 * because the brackets are part of the contract — `document.type` would be
 * silently ignored.
 */
export interface PrivatbankFindDocumentRequest {
  readonly document: {
    readonly type: PrivatbankDocumentType
    /** The code printed on the receipt as "Код документа" — `P24A0000000000A0000`. */
    readonly id: string
  }
}

/**
 * What `POST /pb/ajax/find-document` answers.
 *
 * One shape for all outcomes; which fields are present depends on `status` and
 * on how the request was wrong, so everything but `status` and `token` is
 * optional. Both failures observed still issue a token, and it is useless.
 */
export interface PrivatbankFindDocumentResponse {
  /** `true` only when a document with that code exists. */
  readonly status: boolean
  /**
   * Ukrainian, and the only description of what happened:
   * `'Документ був знайдений'`, `'Документ із цим кодом не знайдено'`,
   * `'Переданий тип документа не підтримуються'`. Identical for a receipt and
   * a statement — the reason never names which kind was asked for.
   *
   * Developer-facing. It is logged and never shown to a user — this product
   * renders its own sentence from an enum, in the user's language.
   */
  readonly reason?: string
  /** Empty object in every capture, successful or not. Nothing reads it. */
  readonly content?: Record<string, unknown>
  /**
   * `'receipt-P24A0000000000A0000.pdf'`, `'statement-QB00000000000000.pdf'`.
   * Present only on success — the bank's own name for the file, always
   * `<type>-<id>.pdf`.
   */
  readonly document_name?: string
  /**
   * `'Квитанція'` on a receipt lookup and `'Довідка/виписка'` on a statement;
   * echoes the request on a bad type.
   */
  readonly document_type?: string
  /** The CSRF token for the download. Bound to the `PHPSESSID` set beside it. */
  readonly token?: string
  /** Echoed back only when the type was rejected: the request as a JSON string. */
  readonly document?: string
  /** Echoed back only when the type was rejected. */
  readonly document_id?: string
}

/**
 * The fields this product reads out of a PrivatBank receipt's text layer.
 *
 * **This is a parsed document, not a payload, and the difference is the risk.**
 * A change to their layout is silent — the same failure mode as the Transacto
 * panel's tables — so whatever produces this must refuse loudly rather than
 * return a partial answer. Every field is required for exactly that reason:
 * a receipt missing one of them cannot be matched against a payout, and a
 * comparison that skipped a missing field would pass every receipt that omitted
 * it.
 *
 * Captured 2026-09-07 from a real receipt, with coordinates, because the
 * flattened text is misleading: the amounts render as one run, `'15,00 500,00'`,
 * under a header run `'Комісія Сума'` at the same left edge — so the **second**
 * number is the payment and the first is the fee. Read positionally against
 * that header, never by taking the first number on the line.
 */
export interface PrivatbankReceiptFields {
  /** UAH kopecks. The `Сума` column, not `Комісія`. */
  readonly amountUah: number
  /** From `Дата виконання`, `DD/MM/YYYY HH:mm`, Kyiv local time. */
  readonly paidAt: Date
  readonly recipient: PrivatbankRecipient
}

/**
 * What PrivatBank prints under `Рахунок отримувача`, and it is not always the
 * same kind of thing.
 *
 * **Which one appears depends on where the money went**, and four captured
 * receipts show the rule cleanly:
 *
 * | Transfer | `Рахунок отримувача` | Recipient's name |
 * |---|---|---|
 * | To another bank's card (`JSC UNIVERSAL BANK`) | the card, sixteen digits, unmasked | `-` |
 * | Within PrivatBank | the recipient's IBAN | printed in full |
 *
 * The two cases are exactly complementary, which is the useful part: a receipt
 * that will not name the card names the person instead. A card can be compared
 * with the card a Transacto payout states; an IBAN cannot, and nothing derives
 * one from the other.
 *
 * Declared as a union rather than as a string that is "usually a card" because
 * the difference decides whether a receipt can be matched at all, and a caller
 * that had to sniff it would eventually forget to.
 */
export type PrivatbankRecipient =
  /**
   * Sixteen digits, in full and unmasked — unlike anything `check.gov.ua`
   * publishes. It makes the recipient check exact rather than probabilistic,
   * and it is a payment credential that must never be logged.
   */
  | { readonly kind: PrivatbankRecipientKind.CARD; readonly card: string }
  /** An account, not a card. Nothing this product holds can be compared with it. */
  | { readonly kind: PrivatbankRecipientKind.IBAN; readonly iban: string }

/** Which of the two {@link PrivatbankRecipient} shapes a receipt carried. */
export enum PrivatbankRecipientKind {
  CARD = 'CARD',
  IBAN = 'IBAN'
}
