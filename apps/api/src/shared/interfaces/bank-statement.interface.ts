import type { BankProvider } from '@transacto/contracts'

/**
 * What a bank statement is, as captured from real documents on 2026-09-17.
 *
 * A statement is asked to prove a **negative** — that a credit the seller
 * denies receiving never arrived — and that is what makes it a different
 * problem from a receipt. A receipt proves one thing happened; a statement
 * proves nothing happened, and only over exactly the period it covers, for
 * exactly the account it names, and only if every row of it was read. Any gap
 * in those three turns "no such credit" into "we did not look", and the two are
 * indistinguishable from the outside.
 *
 * So every shape below is a refusal condition first and a field second.
 *
 * **Both banks serve a signed container, not a PDF.** Monobank's and
 * PrivatBank's statements are both DER PKCS#7 `SignedData` with the document as
 * encapsulated content — the same envelope a monobank receipt arrives in, and
 * `extractSignedPdf` unwraps both unchanged. A statement downloaded by a user
 * and re-saved by a viewer is no longer that container, which is the point: the
 * signature is over the exact bytes.
 *
 * **What was captured, and what was not.** Both documents were read end to end:
 * their signers, their header labels, their separators and their row shapes are
 * facts below. Two things were *not* established and are called out where they
 * matter: whether `ca.monobank.ua/siteapi/verify` will verify a container signed
 * by PrivatBank, and what `document[type]` names a statement at
 * `privatbank.ua/pb/ajax/find-document`. Neither is guessed here.
 *
 * Values are never reproduced in this repository — see the root `CLAUDE.md`.
 * Every example below is invented to the captured shape.
 */

/**
 * **Who signs what, and why only one of them is checked here.**
 *
 * Both statements are signed, and the certificates say so:
 *
 * - monobank — subject `O=АТ «УНІВЕРСАЛ БАНК»`, issuer
 *   `CN=КНЕДП monobank | Universal Bank`. **Already the first entry of
 *   `MONOBANK_SIGNERS`**, which the receipt path checks — so a statement passes
 *   the existing check with nothing added. That is not a coincidence worth
 *   restating in a second constant; it is the same bank signing the same way.
 * - PrivatBank — subject `O=АТ КБ «ПРИВАТБАНК»`, issuer
 *   `CN=КНЕДП АЦСК АТ КБ "ПРИВАТБАНК"`. Recorded because it was observed, and
 *   **deliberately not turned into a check**: PrivatBank statements are proven
 *   by asking PrivatBank for the document number and reading the copy the bank
 *   serves, which makes the upload's signature beside the point. A signer list
 *   nothing consults is a list that quietly goes stale.
 *
 * The quotation marks differ between subject and issuer — guillemets in one,
 * straight quotes in the other — and they are not ours to tidy. Anything that
 * ever does compare these compares the exact strings.
 */

/**
 * One movement on the account, reduced to the three things a verdict needs.
 *
 * Everything else a row carries — the merchant, the terminal, the comment, the
 * counterparty's masked card — is deliberately dropped rather than parsed.
 * It is somebody's spending history, none of it decides anything here, and the
 * less of it this process holds the better.
 */
export interface StatementMovement {
  /**
   * When it happened.
   *
   * Both banks print a Kyiv wall clock with no offset on it, and everything
   * this is compared against is UTC — so it is converted through
   * `fromKyivWallClock`, which asks the tz database. A fixed `+03:00` would be
   * right for eight months of the year and an hour out for the other four, and
   * an hour is the difference between a credit inside an order's window and one
   * outside it.
   */
  readonly at: Date
  /**
   * The amount **in the account's currency**, in kopecks, signed.
   *
   * Positive is money arriving, which is the only kind this product asks about.
   * Taken from the card-currency column and never from the operation-currency
   * one: a ₴1 428 credit funded from a card in another currency states a
   * different figure there, and the payout was in hryvnia.
   */
  readonly amountKopecks: number
  readonly currencyCode: string
}

/**
 * A statement, once it has been read.
 *
 * **`unreadableRows` is the field the whole design rests on.** A row that looks
 * like a row and did not parse is counted here, never skipped, exactly as
 * `panel-table.util.ts` counts the payout rows it cannot read — because a
 * statement that quietly dropped the one row in question would prove the
 * opposite of what it says. A caller refuses on any non-zero value.
 */
export interface ParsedStatement {
  readonly bank: BankProvider
  /** The account holder, as the bank names them. Rewrites the sale's receiver. */
  readonly ownerName: string
  /** The last four digits of the card, from the mask the document prints. */
  readonly cardTail: string
  /** The account's IBAN as printed, kept only to tell two accounts apart. */
  readonly iban: string | null
  /**
   * The period the document covers.
   *
   * Dates, not moments: both banks print a day range with no time, so the
   * window runs from the start of `from` to the end of `to`. A reader that
   * treated `to` as midnight would declare a statement short of its own last
   * day, and refuse every same-day dispute there is.
   */
  readonly periodFrom: Date
  readonly periodTo: Date
  /**
   * What the document says arrived over the whole period, in kopecks.
   *
   * A free cross-check that needs no row parsing at all: a period total of zero
   * settles a denial outright, whatever the rows say. `null` when the label was
   * not found, which is itself worth refusing on.
   */
  readonly totalCreditedKopecks: number | null
  readonly movements: readonly StatementMovement[]
  /** Rows that looked like rows and could not be read. Any is a refusal. */
  readonly unreadableRows: number
  /**
   * Whether the credits found add up to the total the bank itself printed.
   *
   * **The integrity check that catches what counting rows cannot**, and it is
   * not theoretical. `apps/receipt-checker` reads at most `MAX_PAGES` — ten —
   * and a statement is routinely longer: the PrivatBank document captured here
   * has eleven pages. When a page is dropped, its rows leave no anchor behind
   * to be counted as unreadable, so the statement parses cleanly and is simply
   * missing movements. The one thing that still disagrees is this sum.
   *
   * `null` when the header total was not found, which a caller refuses on
   * exactly as it refuses a mismatch: a statement that cannot be reconciled has
   * not been read, whatever it looks like.
   */
  readonly creditsReconciled: boolean | null
}

/**
 * Monobank's statement — «Рух коштів по картці».
 *
 * Captured from a real document, structure only. Header fields are one
 * `Label: value` per line; after `apps/receipt-checker` normalises whitespace
 * they are simply `Label: value` inside one long line, which is what the parser
 * reads.
 *
 * ```text
 * Клієнт: Прізвище Ім'я По батькові
 * Інформація по картці: 5375 **** **** 4321
 * Рахунок: UA000000000000000000000000000
 * Період: 01.09.2026 - 17.09.2026
 * Сума витрат за період: 1 470.00 UAH
 * Сума зарахувань за період: 1 470.00 UAH
 * ```
 *
 * And a row, after normalisation — the date and time lead, and a fixed tail of
 * eight fields closes it:
 *
 * ```text
 * 14.09.2026 14:12:03 Від: Ivan Petrenko 4829 1 470.00 1 470.00 UAH — 0.00 0.00 2 076.00
 * └ date    └ time    └ details          └MCC └card    └operation└cur └rate └fee └cashback └balance
 * ```
 *
 * Four things are load-bearing:
 *
 * - **The card-currency amount is the first of the pair**, before the currency
 *   code. PrivatBank puts it after. Reading the wrong one converts a foreign
 *   credit at the wrong figure.
 * - **Amounts use a dot**, and a space for thousands. PrivatBank uses a comma.
 * - **`Період` is separated by a hyphen**, where PrivatBank uses an em dash.
 * - **The table header reads `Дата i час` with a LATIN `i`.** Nothing anchors on
 *   it, and nothing should: it is the kind of homoglyph that makes a Ukrainian
 *   string literal match nothing at all.
 *
 * Two rows were observed, one credit and one debit, and both carried an MCC.
 * Whether a transfer between a customer's own accounts prints one is unknown,
 * so a row without one is counted unreadable rather than assumed.
 */
export const MONOBANK_STATEMENT_LABELS = {
  OWNER: 'Клієнт:',
  CARD: 'Інформація по картці:',
  ACCOUNT: 'Рахунок:',
  PERIOD: 'Період:',
  TOTAL_CREDITED: 'Сума зарахувань за період:'
} as const

/**
 * PrivatBank's statement — «Виписка по картці».
 *
 * ```text
 * Власник рахунку: Прізвище Ім'я По батькові
 * Інформація по картці: 537541******4321
 * Рахунок IBAN: UA000000000000000000000000000
 * Період: 01.09.2026 — 17.09.2026
 * Усього надходжень: 1 428,00
 * ```
 *
 * A row, after normalisation — note the currency sits *between* the two
 * amounts, the opposite way round from monobank:
 *
 * ```text
 * 14.09.2026 14:12 537541******4321Угода № … Деталі операції -123,45 UAH -123,45 0,00 0,00 -12 345,67
 * └ date    └ time └ card+contract └ details  └operation└cur └card   └fee  └disc └balance
 * ```
 *
 * Three things are load-bearing, beyond the separators above:
 *
 * - **Every page carries a header that begins with a date and a time**, and so
 *   looks exactly like the start of a row:
 *   `17.09.2026 12:20 № QB00000000000000 Сторінка 1 з 11`. In the captured
 *   document there were 83 date-and-time anchors: 73 rows and 10 page headers.
 *   A reader that counted anchors and subtracted the rows it parsed would have
 *   declared ten unreadable rows on a statement it had read perfectly, and
 *   refused it. **Page headers are recognised and excluded before anything is
 *   counted.**
 * - **The time carries no seconds** (`14:12`), where monobank's does.
 * - **The document number in the page header is the same string as the file's
 *   own name** — `QB…` — and `pb.ua/check` will show the document for it. That
 *   is the shape of a far stronger check than reading an upload, and it is not
 *   built: `document[type]` for a statement at
 *   `privatbank.ua/pb/ajax/find-document` has never been captured, and
 *   `PrivatbankDocumentType` therefore still names only `receipt`.
 *
 * The transaction details are full of Latin/Cyrillic homoglyphs — `Iрпiнь`
 * spelled with a Latin `I` and `i` — which is one more reason nothing here
 * parses them.
 */
export const PRIVATBANK_STATEMENT_LABELS = {
  OWNER: 'Власник рахунку:',
  CARD: 'Інформація по картці:',
  ACCOUNT: 'Рахунок IBAN:',
  PERIOD: 'Період:',
  TOTAL_CREDITED: 'Усього надходжень:'
} as const
