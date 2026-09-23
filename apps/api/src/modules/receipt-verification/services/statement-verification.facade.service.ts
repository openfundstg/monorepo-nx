import { StatementSubject } from 'src/shared/interfaces'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { BankProvider, SaleStatementRejection } from '@transacto/contracts'
import { STATEMENT_VERIFICATION_PROVIDERS } from 'src/modules/receipt-verification/receipt-verification.tokens'
import { ReceiptCheckerApiService } from 'src/modules/receipt-verification/services/receipt-checker.api.service'
import {
  isAttested,
  StatementFinding,
  type StatementExpectation,
  type StatementSubmission,
  type StatementVerification,
  type StatementVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import type { ParsedStatement } from 'src/shared/interfaces'
import { canReadStatement, describeError, parseStatement } from 'src/shared/utils'

/**
 * Whether a statement says a credit arrived, and whether it is allowed to say.
 *
 * **A statement is asked to prove a negative**, which is what makes this more
 * than a search. "No such credit" is only worth anything from a document that
 * is the bank's, is for this account, spans the whole window and was read in
 * full — and every one of those four is a way for a genuine-looking document to
 * prove nothing at all. They are checked in that order, before the rows are so
 * much as looked at.
 *
 * The order matters for what the sender is told. A statement for the wrong
 * account should say so; discovering it after concluding "no credit found"
 * would mean the conclusion was reached on the wrong document and happened to
 * be discarded.
 *
 * **Finding a credit is not the safe direction.** A false `NOT_CREDITED`
 * refuses to settle an order and an operator sorts it out; a false `CREDITED`
 * executes it, spending a seller's USDT for hryvnia they never received. That
 * asymmetry is why the amount is matched exactly rather than within a
 * tolerance — see {@link matches}.
 */
@Injectable()
export class StatementVerificationFacadeService {
  private readonly logger = new Logger(StatementVerificationFacadeService.name)

  constructor(
    @Inject(STATEMENT_VERIFICATION_PROVIDERS)
    private readonly providers: readonly StatementVerificationProvider[],
    private readonly checker: ReceiptCheckerApiService
  ) {}

  /** Whether a statement from this bank can be checked at all. */
  supports(bank: BankProvider): boolean {
    return canReadStatement(bank) && this.providers.some((provider) => provider.supports(bank))
  }

  async verify(
    submission: StatementSubmission,
    expectation: StatementExpectation
  ): Promise<StatementVerification> {
    const provider = this.providers.find((candidate) => candidate.supports(submission.bank))

    if (!provider || !canReadStatement(submission.bank)) {
      // Not the sender's fault: this build has no way to check their bank's
      // statements, which is a promise `CARD_SALE_ENABLED_BANKS` should not
      // have made.
      this.logger.error(
        `A ${submission.bank} statement arrived and nothing can check it. ` +
          `Either a provider is unregistered or the bank should not be on CARD_SALE_ENABLED_BANKS.`
      )

      return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE, statement: null }
    }

    try {
      const attestation = await provider.attest(submission)

      // Nothing vouched for it, so nothing reads it. The union is what makes
      // that structural rather than remembered: `document` does not exist on
      // the refusal branch.
      if (!isAttested(attestation)) return { rejection: attestation.rejection, statement: null }

      const text = await this.checker.extractText(attestation.document)
      const statement = parseStatement(text.text, attestation.bank)

      if (statement === null) {
        // The document is the bank's — that has already been established — and
        // this build could not read it, which is the shape a change in their
        // rendering takes. Loud, because the alternative is a run of statements
        // quietly going to operators.
        this.logger.error(
          `A ${submission.bank} statement is attested and its layout could not be read: ` +
            `${text.text.length} characters via ${text.source}. The labels this build looks ` +
            `for are in bank-statement.interface.ts.`
        )

        return { rejection: SaleStatementRejection.UNREADABLE, statement: null }
      }

      return this.judge(statement, expectation)
    } catch (error: unknown) {
      // Only the unexpected reaches here now: a refusal is a value, so this is
      // the extractor or the parser failing, never a verdict.
      this.logger.error(`A statement could not be checked: ${describeError(error)}`)

      return { rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE, statement: null }
    }
  }

  /**
   * The four things that must hold before the rows mean anything, then the rows.
   *
   * Nothing here logs a figure off the statement. The document is somebody's
   * whole spending history and none of it is ours to print — what goes in the
   * log is which check failed.
   */
  private judge(
    statement: ParsedStatement,
    expectation: StatementExpectation
  ): StatementVerification {
    // 1. Is it this account's? A statement for another card says nothing about
    //    this one, however complete it is.
    if (statement.cardTail !== expectation.cardTail)
      return { rejection: SaleStatementRejection.WRONG_ACCOUNT, statement }

    // 2. Does it span the window? A document that stops before the credit would
    //    have landed proves nothing about the part it misses — and reading that
    //    as "no credit found" is the one failure this whole design exists to
    //    make impossible.
    //
    //    **Against `mustCoverTo`, not `to`.** The window's upper edge includes a
    //    grace for a bank posting late, which at the moment a seller is asked
    //    for a statement is still in the future — and this used to demand a
    //    document covering it. A bank issues whole days, so where that grace
    //    crossed midnight no same-day statement could ever pass, however
    //    complete it was.
    //
    //    **And only a denial is held to it.** Covering the window is what makes
    //    an *absence* provable, and an absence is the only thing a denial can
    //    be settled by. A shortfall asks a different question — how much
    //    arrived — which the checkpoint answers from whatever credits the
    //    document does hold, a sum that is a lower bound by construction and
    //    capped at the order, so a partial document can only under-correct.
    //    Refusing both alike stranded sale 9CTBSY7W: the seller's statement
    //    ended at midnight, the window ran thirty seconds past it, and the
    //    correction it carried was thrown away with the document. The same file
    //    had been accepted nine minutes earlier, before the day turned over.
    if (!this.reachesFarEnough(statement, expectation))
      return { rejection: SaleStatementRejection.PERIOD_TOO_SHORT, statement }

    // 3. Was every row read? A row that looked like a row and did not parse is
    //    counted rather than skipped, precisely so this check can exist.
    if (statement.unreadableRows > 0) {
      this.logger.error(
        `A statement has ${statement.unreadableRows} row(s) this build could not read; ` +
          `refusing rather than concluding anything from the rest.`
      )

      return { rejection: SaleStatementRejection.UNREADABLE, statement }
    }

    // 4. Do the credits add up to the bank's own period total? The check that
    //    catches what counting rows cannot: `apps/receipt-checker` reads at most
    //    ten pages and statements are longer, and a dropped page leaves no
    //    anchor behind to count.
    if (statement.creditsReconciled !== true) {
      this.logger.error(
        `A statement's credits do not reconcile with the total it prints ` +
          `(${statement.creditsReconciled === null ? 'no total found' : 'mismatch'}); ` +
          `a page was probably dropped. Refusing.`
      )

      return { rejection: SaleStatementRejection.UNREADABLE, statement }
    }

    const arrived = this.arrivedInWindow(statement, expectation)

    if (arrived > 0 && arrived !== expectation.amountKopecks) {
      // Something landed in this order's window and it is not this order's
      // amount. Reported rather than rounded to a verdict: the seller is owed
      // the difference between "nothing came" and "something else came", and so
      // is whoever reads this log.
      this.logger.warn(
        `A statement's window for this order holds credits that do not add up to it; ` +
          `treating the order as not credited.`
      )
    }

    return {
      finding:
        arrived === expectation.amountKopecks
          ? StatementFinding.CREDITED
          : StatementFinding.NOT_CREDITED,
      statement
    }
  }

  /**
   * What the statement shows arriving inside this order's window, in kopecks.
   *
   * **Summed, not matched one by one.** A single Transacto order can be paid by
   * several transfers — ₴400 and ₴600 against a ₴1 000 order is an ordinary way
   * for it to arrive — and a check that looked for one movement of the whole
   * amount would report every split payment as money that never came, which is
   * the one conclusion this design exists to make impossible.
   *
   * The window is the order's own, capped at the next order's arrival so a
   * neighbour's credit cannot be read as this one's, and the clock has already
   * been converted through the tz database rather than assumed — see
   * `fromKyivWallClock`.
   *
   * **The total is then compared exactly, with no tolerance.** The receipt path
   * allows a transfer fee to inflate a figure because the payer covers it;
   * nothing inflates what lands on a card. Too strict refuses to settle an order
   * and an operator sorts it out; too loose spends a seller's stake for money
   * they never got.
   */
  /**
   * Whether this document reaches far enough to answer what it was sent for.
   *
   * A denial needs the whole window: the credit it denies could be anywhere in
   * it, so a document that stops early has not looked where the rest of it
   * would be, and reading that as "no credit found" is the one failure this
   * design exists to make impossible.
   *
   * A shortfall needs only to overlap it. What settles that claim is the
   * checkpoint's arithmetic over the credits the document holds — never its
   * silence — so the honest requirement is that it holds some of this window at
   * all. A document from another month says nothing about this order, and the
   * seller is better told that than left to wonder why nothing moved.
   */
  private reachesFarEnough(
    statement: ParsedStatement,
    expectation: StatementExpectation
  ): boolean {
    if (expectation.subject === StatementSubject.DENIAL)
      return statement.periodFrom <= expectation.from && statement.periodTo >= expectation.mustCoverTo

    return statement.periodTo >= expectation.from && statement.periodFrom <= expectation.to
  }

  private arrivedInWindow(
    statement: ParsedStatement,
    expectation: StatementExpectation
  ): number {
    return statement.movements.reduce(
      (total, movement) =>
        movement.amountKopecks > 0 &&
        movement.at >= expectation.from &&
        movement.at <= expectation.to
          ? total + movement.amountKopecks
          : total,
      0
    )
  }
}
