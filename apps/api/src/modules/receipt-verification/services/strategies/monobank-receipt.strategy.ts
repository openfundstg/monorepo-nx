import { Injectable } from '@nestjs/common'
import { BankProvider } from '@transacto/contracts'
import type { ReceiptCodeStrategy } from 'src/modules/receipt-verification/interfaces'

/**
 * A monobank receipt code as their own input mask builds it: four groups of
 * four, dash-separated, letters and digits both.
 *
 * From `check.gov.ua`'s `js/index.js` (captured 2026-09-07), which declares
 * monobank as `blocks: [4,4,4,4], delimiters: ['-','-','-'], isDigits: false`.
 * PrivatBank is declared with the same blocks and `isDigits: true`, which is
 * exactly why the format belongs to a per-bank strategy rather than to one
 * shared pattern: sixteen digits is a valid PrivatBank code and an invalid
 * monobank one, and a pattern loose enough for both would let each bank's codes
 * be looked up under the other's name.
 */
const DASHED_CODE =
  /(?<![0-9A-Z-])([0-9A-Z]{4}\s*-\s*[0-9A-Z]{4}\s*-\s*[0-9A-Z]{4}\s*-\s*[0-9A-Z]{4})(?![0-9A-Z-])/

/**
 * Whitespace a layout put inside a code, which is not part of it.
 *
 * A receipt prints its code in groups, and both a PDF's text layer and an
 * optical read are entitled to put a line break between them. The dashes are
 * what identify the code; the spacing around them is typography.
 */
const LAYOUT_SPACING = /\s+/g

/**
 * What separates a monobank code from everything else shaped like one.
 *
 * Required of **both** forms, and the dashed form is the interesting case:
 * `1234-5678-9012-3456` is a perfectly good *PrivatBank* code — their
 * `js/index.js` declares PrivatBank as sixteen digits and monobank as sixteen
 * alphanumerics — so a monobank strategy that accepted an all-digit code would
 * claim their receipts and look them up under the wrong company.
 *
 * The trade is deliberate and one-sided. Refusing an all-digit monobank code
 * costs a user one retry with a clearer file, and it is a code this product has
 * never seen; claiming a PrivatBank one costs them a rejected receipt and a
 * top-up in an operator's hands, for a receipt that was real.
 */
const HAS_LETTER = /[A-Z]/

/**
 * The same code with the dashes taken out, which is how monobank names the
 * file: `297X351KC1T2BKMB.pdf`.
 *
 * Every sixteen-character run is a candidate; {@link HAS_LETTER} is what
 * decides. Digits alone are rejected because a bare run of sixteen digits is a
 * card number far more often than it is a receipt code, and a card number is
 * exactly the kind of sixteen-character run a receipt is full of.
 *
 * Checked afterwards rather than folded in here as a lookahead: a lookahead for
 * a letter matches one anywhere ahead in the text, not one inside the sixteen
 * characters, so it would accept a card number followed later on the receipt by
 * any capital at all.
 */
const BARE_CODE_CANDIDATES = /(?<![0-9A-Z])[0-9A-Z]{16}(?![0-9A-Z])/g

/** A trailing file extension, which is never part of the code. */
const EXTENSION = /\.[^.]+$/

/** Where a bank's dashes go, once a bare code has been recovered. */
const GROUP_SIZE = 4

/** Splits a bare code into the groups {@link GROUP_SIZE} describes. */
const GROUPS = new RegExp(`.{${GROUP_SIZE}}`, 'g')

/**
 * **Strategy — monobank.** Finding a monobank receipt code in an uploaded file.
 *
 * Two sources, tried in the order of how much they can be trusted.
 *
 * 1. **The file's name.** A receipt downloaded from monobank is served as
 *    `297X351KC1T2BKMB.pdf` — the code itself, with its dashes removed. Nothing
 *    has to be recognised for that to be right, so it is read first and it is
 *    the only source that cannot misread.
 * 2. **The text.** A dashed code as printed on the receipt, then a bare one.
 *
 * Nothing here talks to anybody. A strategy answers "is this one of ours, and
 * what is its code" and stops; whether that code names a real payment is the
 * verifier's question, asked by the facade through a provider.
 */
@Injectable()
export class MonobankReceiptStrategy implements ReceiptCodeStrategy {
  readonly bank = BankProvider.MONO

  /**
   * The code monobank named the file, if it named it one.
   *
   * The extension is dropped first so that a `.pdf` cannot end up inside the
   * sixteen characters, and the name is upper-cased because a phone that
   * re-saves a download is entitled to change its case.
   */
  findCodeInFileName(fileName: string): string | null {
    return this.match(fileName.replace(EXTENSION, '').toUpperCase())
  }

  findCodeInText(text: string): string | null {
    return this.match(text.toUpperCase())
  }

  private match(value: string): string | null {
    const dashed = DASHED_CODE.exec(value)?.[1]?.replace(LAYOUT_SPACING, '')
    if (dashed !== undefined && HAS_LETTER.test(dashed)) return dashed

    const bare = [...value.matchAll(BARE_CODE_CANDIDATES)]
      .map(([candidate]) => candidate)
      .find((candidate) => HAS_LETTER.test(candidate))

    return bare === undefined ? null : this.dash(bare)
  }

  /** `297X351KC1T2BKMB` → `297X-351K-C1T2-BKMB`, the form the verifier is asked in. */
  private dash(bare: string): string {
    return (bare.match(GROUPS) ?? []).join('-')
  }
}
