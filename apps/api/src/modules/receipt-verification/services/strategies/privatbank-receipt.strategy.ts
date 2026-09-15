import { Injectable } from '@nestjs/common'
import { BankProvider } from '@transacto/contracts'
import type { ReceiptCodeStrategy } from 'src/modules/receipt-verification/interfaces'

/**
 * A PrivatBank document code as their receipt prints it under "Код документа",
 * and as they name the file: `receipt-P24A0000000000A0000.pdf`.
 *
 * **The digit groups are asserted; the two letters are not.** Four receipts
 * captured across three months (June and September 2026) agree exactly on the
 * shape — `P24`, a letter, ten digits, a letter, four digits — so the structure
 * is worth pinning:
 *
 *     P24A0000000000A0000   P24A0000000003A0003
 *     P24A0000000001A0001   P24A0000000002A0002
 *
 * All four carry `A` and `D` in those two positions, and four samples of one
 * document type cannot show whether those letters mean "receipt" or mean
 * nothing. Fixing them would be over-fitting on a sample; leaving the digit
 * counts free would let a card number's tail be read as a code. So the letters
 * are `[A-Z]` and the lengths are exact.
 *
 * **This is not the code `check.gov.ua` asks PrivatBank for.** Their page
 * declares PrivatBank as sixteen digits (`isDigits: true`), and this is nineteen
 * characters: two different identifiers for two different services, and neither
 * will answer for the other's. It is the reason PrivatBank is verified through
 * PrivatBank rather than through the state service.
 */
const DOCUMENT_CODE = /(?<![0-9A-Z])(P24[A-Z]\d{10}[A-Z]\d{4})(?![0-9A-Z])/

/** A trailing file extension, which is never part of the code. */
const EXTENSION = /\.[^.]+$/

/**
 * **Strategy — PrivatBank.** Finding a PrivatBank document code in an upload.
 *
 * The same two sources as monobank's, in the same order and for the same
 * reason: PrivatBank names its download `receipt-P24A0000000000A0000.pdf`, so
 * the ordinary upload is identified exactly and without an optical read that
 * could misread a character.
 *
 * The prefix that makes the filename readable is also what keeps the two banks
 * apart. A monobank code is sixteen alphanumerics with no prefix and a
 * PrivatBank one is `P24` plus sixteen — neither pattern matches the other's
 * codes, so the facade asking strategies in order is asking a question only one
 * of them can answer.
 */
@Injectable()
export class PrivatbankReceiptStrategy implements ReceiptCodeStrategy {
  readonly bank = BankProvider.PRIVAT

  /**
   * The code PrivatBank named the file, if it named it one.
   *
   * The name is `receipt-<code>.pdf`; the pattern is anchored rather than
   * anchored-to-that-shape, so a file re-saved as `receipt-<code> (1).pdf` — a
   * download the browser had to disambiguate — still reads.
   */
  findCodeInFileName(fileName: string): string | null {
    return this.match(fileName.replace(EXTENSION, '').toUpperCase())
  }

  findCodeInText(text: string): string | null {
    return this.match(text.toUpperCase())
  }

  private match(value: string): string | null {
    return DOCUMENT_CODE.exec(value)?.[1] ?? null
  }
}
