import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  PayloadTooLargeException
} from '@nestjs/common'
import { Types } from 'mongoose'
import {
  BankProvider,
  ERROR,
  isAcceptedStatementFile,
  SALE_STATEMENT_MAX_BYTES,
  SaleCardOrderState,
  SaleEventType,
  SaleReceiverNameSource,
  SaleStatementStatus
} from '@transacto/contracts'
import {
  isStatementFinding,
  StatementFinding,
  StatementVerificationFacadeService
} from 'src/modules/receipt-verification'
import {
  MINUTE_MS,
  SALE_STATEMENT_LATE_CREDIT_GRACE_MINUTES
} from 'src/shared/constants'
import type { ParsedStatement } from 'src/shared/interfaces'
import { awaitsStatementCheckpoint } from 'src/shared/utils'
import { StatementSubject } from 'src/shared/interfaces'
import {
  coverageRequiredTo,
  statementCorrection,
  windowForOrder
} from 'src/modules/telegram-mini-app/utils'
import type { StoredSale, TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleStatementStorageService } from 'src/modules/telegram-mini-app/services/sale-statement-storage.service'
import type { ReceiptFile } from 'src/shared/interfaces'
import { describeError } from 'src/shared/utils'
import type { StatementExpectation } from 'src/modules/receipt-verification'


/** The states an upload may still be doing something. */
const IN_FLIGHT = [SaleStatementStatus.UPLOADED, SaleStatementStatus.PARSING] as const

/**
 * The document a seller sends when they say the money never arrived.
 *
 * **It is the only thing in this variant that can contradict them**, and it
 * settles the dispute in either direction: a credit found means the order is
 * executed on the document rather than on anybody's word, and a document that
 * covers the window and holds no such credit means the denial stands and an
 * operator takes it to Transacto.
 *
 * The order of what happens here is the design:
 *
 * 1. **Stored before it is judged.** A refused statement is kept too — an
 *    operator has to be able to open the document that this build could not
 *    read, which is the only way "their layout changed" ever gets fixed.
 * 2. **Judged by the facade**, which proves it is the bank's before reading a
 *    row of it. Neither this service nor the Mini App learns how that is done,
 *    and the two banks do it completely differently.
 * 3. **The verdict moves the order, never the statement alone.** A statement
 *    that proved something and left the order where it was would be a document
 *    nobody acted on.
 */
@Injectable()
export class SaleStatementService {
  private readonly logger = new Logger(SaleStatementService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly storage: SaleStatementStorageService,
    private readonly verification: StatementVerificationFacadeService,
    private readonly cardOrders: SaleCardOrderService,
    private readonly progressService: SaleProgressService
  ) {}

  /**
   * Takes one statement against one disputed order, and acts on what it says.
   *
   * Returns the sale as it now stands — accepted, refused or contradicted are
   * all ordinary answers, and the Mini App renders the rejection rather than an
   * error.
   */
  async submit(
    telegramId: number,
    saleId: string,
    orderId: number,
    file: ReceiptFile
  ): Promise<StoredSale> {
    const { sale, cardOrder, answers } = await this.load(telegramId, saleId, orderId)

    this.assertAcceptable(file)
    this.assertNothingInFlight(cardOrder)

    const bank = sale.bankType as BankProvider

    if (!this.verification.supports(bank))
      throw new BadRequestException(ERROR.SALE_CARD.STATEMENT_UNSUPPORTED_BANK)

    // Minted here, because the file on disk is named after it: letting Mongo
    // choose would leave the bytes written under a name nothing yet knew.
    const statementId = new Types.ObjectId()
    const storedName = await this.storage.save(statementId.toHexString(), file)

    const stored = await this.saleDbService.pushStatement(
      saleId,
      orderId,
      { _id: statementId, bank, storedName, sizeBytes: file.buffer.length },
      // The decision `load` already made, re-applied atomically — never the rule
      // restated. Restating it is what made every checkpoint statement a 409.
      answers
    )

    if (!stored) {
      // The order stopped being the thing it was between the read and the write
      // — a denial confirmed here or in the bot, a claim settled by a statement
      // that arrived first. The upload is undone rather than left orphaned on
      // disk.
      await this.storage.remove(storedName)

      throw new ConflictException(ERROR.SALE_CARD.STATEMENT_NOT_REQUIRED)
    }

    await this.saleDbService.appendEvent(saleId, {
      type: SaleEventType.STATEMENT_SUBMITTED,
      orderId,
      at: Date.now()
    })

    return this.judge(stored, cardOrder, statementId, { bank, uploaded: file })
  }

  /** Runs the check and applies whatever it concluded. */
  private async judge(
    sale: StoredSale,
    cardOrder: TmaSaleCardOrder,
    statementId: Types.ObjectId,
    submission: { bank: BankProvider; uploaded: ReceiptFile }
  ): Promise<StoredSale> {
    const saleId = sale._id.toString()

    const verification = await this.verification.verify(
      submission,
      this.expectationFor(sale, cardOrder)
    )
    const statement = verification.statement

    await this.saleDbService.markStatementParsed(saleId, statementId, {
      status: isStatementFinding(verification)
        ? SaleStatementStatus.ACCEPTED
        : SaleStatementStatus.REJECTED,
      rejection: isStatementFinding(verification) ? null : verification.rejection,
      periodFrom: statement?.periodFrom,
      periodTo: statement?.periodTo,
      ownerName: statement?.ownerName,
      accountTail: statement?.cardTail
    })

    if (!isStatementFinding(verification)) {
      this.logger.warn(
        `Sale ${sale.publicId}: a statement for order ${cardOrder.orderId} proved nothing ` +
          `(${verification.rejection}); the dispute stands.`
      )

      await this.saleDbService.appendEvent(saleId, {
        type: SaleEventType.STATEMENT_REJECTED,
        orderId: cardOrder.orderId,
        at: Date.now()
      })

      return this.reread(saleId, sale)
    }

    // A bank naming its own customer outranks anything typed into a form. Done
    // for an accepted statement whichever way it went — the document is the
    // bank's either way, and who the account belongs to does not depend on
    // whether a particular credit was on it.
    if (statement !== null) await this.adoptReceiverName(sale, statement.ownerName)

    // **The document is a checkpoint, not an answer about one payment.** It
    // covers a period, and every claim the seller made inside that period has
    // now been read — so they are all settled here, not just the one this upload
    // was addressed to.
    if (statement !== null) await this.checkpoint(sale, statement)

    // A statement uploaded to settle a shortfall, not to answer a denial. The
    // checkpoint above is the whole of its job, and it is the whole of it
    // **whichever way the document came out** — an order nobody denied has no
    // denial for a credit to overturn.
    //
    // **Asked before the finding, and it used to be asked after it.** Only the
    // refusing branch was guarded, so a statement that *found* the credit went
    // on to confirm an order the seller had confirmed himself hours earlier.
    // Transacto answered `106 Order already executed` — which was then read as
    // a failure — and the upload came back a `503`, after the checkpoint and
    // the correction had already been written. The seller was shown an error
    // for a document that had done everything it was sent to do, and the
    // wasted `orders_execute` left a fresh execution marker on a settled order
    // for `handleOrderPaid` to interpret.
    if (cardOrder.state !== SaleCardOrderState.DISPUTED) return this.reread(saleId, sale)

    if (verification.finding === StatementFinding.CREDITED)
      return this.cardOrders.confirmFromStatement(sale, cardOrder)

    return this.upholdDenial(sale, cardOrder)
  }

  /**
   * Settles every claim the document reaches, and records how far it reached.
   *
   * **This is what makes a statement a checkpoint rather than an answer about
   * one payment.** It covers a period; every card order the seller answered
   * inside that period has now been read against the bank's own record, so all
   * of them are settled here — including the ones that were never in dispute.
   *
   * Only a claim can be corrected, and only upwards. A seller who declared the
   * whole order has claimed nothing to check; a seller who declared less than
   * the bank shows kept the difference, and it goes back onto the target. The
   * reverse — the bank showing less than they claimed — needs no correction at
   * all, because understating their own receipts is the direction that costs
   * them and nobody else.
   *
   * **A window holding more than one credit is left alone.** Two transfers of
   * unknown provenance inside six minutes cannot be told apart by amount, and
   * guessing which was the order's would either invent a correction or miss a
   * real one. It is logged, and an operator has the document.
   */
  private async checkpoint(sale: StoredSale, statement: ParsedStatement): Promise<void> {
    const saleId = sale._id.toString()

    const { correctionKopecks, unsettled } = statementCorrection(
      sale.cardOrders ?? [],
      statement,
      SALE_STATEMENT_LATE_CREDIT_GRACE_MINUTES * MINUTE_MS
    )

    // Louder than a correction, because it is a worse fact. The seller said a
    // payment arrived, their USDT went out against it, and the bank's own record
    // of that window holds no credit at all. Nothing is deducted — a correction
    // moves a figure and this needs a person.
    for (const claim of unsettled) {
      this.logger.error(
        `Sale ${sale.publicId}: order ${claim.orderId} was confirmed for ` +
          `${claim.declaredKopecks} kopecks and this statement shows no credit at all in its ` +
          `window. Left as it stands, for an operator.`
      )
    }

    const updated = await this.saleDbService.applyStatementCheckpoint(
      saleId,
      statement.periodTo,
      correctionKopecks
    )

    if (correctionKopecks > 0) {
      this.logger.warn(
        `Sale ${sale.publicId}: a statement shows ${correctionKopecks} kopecks more than its ` +
          `seller declared. Corrected against the target.`
      )
    }

    if (updated === null) {
      this.logger.debug(
        `Sale ${sale.publicId}: a later statement already reaches past this one; nothing moved.`
      )
    }
  }

  /**
   * The document covered the window and held no such credit.
   *
   * Delegated rather than done here, and that is the fix as much as the
   * behaviour is. Three transitions lead out of `DISPUTED` and each has to put
   * the terminal back into service; two of them lived in `SaleCardOrderService`
   * and this one did not, so this was the one that forgot. It now sits beside
   * its siblings — see {@link SaleCardOrderService.denyFromStatement}.
   */
  private async upholdDenial(sale: StoredSale, cardOrder: TmaSaleCardOrder): Promise<StoredSale> {
    const moved = await this.cardOrders.denyFromStatement(sale, cardOrder)

    return moved ?? this.reread(sale._id.toString(), sale)
  }

  /**
   * Replaces the recipient's name with the one the bank states.
   *
   * **The name the seller typed decides nothing, and a disagreement here is
   * noted rather than acted on.** The bank's own word replaces it and the
   * statement's verdict is untouched: nothing is refused, held or flagged over
   * a name. That is deliberate, because the comparison cannot tell the case
   * worth knowing about from the commonest honest one — a seller who wrote
   * `Петренко Р. І.` for an account the bank calls `Петренко Роман Іванович`
   * disagrees with it exactly as loudly as somebody naming a different person,
   * and no amount of string handling separates the two. A check that cannot be
   * trusted must not be a gate.
   *
   * It is still worth a line. On this variant nothing else ever looks at who
   * the destination belongs to, so this is the only place the fact is ever
   * stated at all — and an operator reading a sale afterwards has it.
   *
   * **Nothing is sent upstream, and that is Transacto's limit rather than an
   * omission.** The name a payer sees lives on the credential, and their
   * `credentials_update` does not accept `name` — nor `cred`, nor
   * `terminal_name`; nothing identifying a credential can be changed after it
   * exists, and no endpoint in their API renames anything. See
   * {@link TransactoCredentialsUpdateRequest}. So this sale's payers keep
   * seeing whatever the seller typed, and what the bank says is kept for the
   * operator, for the admin panel, and for the next sale to be created with.
   */
  private async adoptReceiverName(sale: StoredSale, ownerName: string): Promise<void> {
    if (sale.receiverNameSource === SaleReceiverNameSource.STATEMENT) return

    const declared = (sale.receiverName ?? '').trim()

    if (declared !== '' && declared.toLowerCase() !== ownerName.toLowerCase()) {
      // A record, not a finding. `warn` rather than `error` because nothing is
      // waiting on it: the bank's name is adopted below and the document's
      // verdict stands either way. It used to say "for an operator", which read
      // as a statement being held for one — and it was read that way.
      this.logger.warn(
        `Sale ${sale.publicId}: the seller named the payout account differently from the bank. ` +
          `Taking the bank's name; the statement is unaffected.`
      )
    }

    await this.saleDbService
      .rewriteReceiverName(sale._id.toString(), ownerName)
      .catch((error: unknown) => {
        // The verdict is what matters and it has already been applied. A name
        // that did not move is cosmetic beside it.
        this.logger.error(
          `Sale ${sale.publicId}: could not adopt the statement's name: ${describeError(error)}`
        )
      })
  }

  /**
   * What the statement is being asked about.
   *
   * The window runs from the order arriving to a few hours past its deadline —
   * **not to now**, which is what it used to do. A seller can upload a statement
   * days after the fact, and ending the window where they happened to upload it
   * made it grow with their delay.
   *
   * That is generous in the direction this whole design says not to be. A credit
   * found here means the seller denied money they received, so the order is
   * executed and their stake is spent; a credit not found only sends the dispute
   * to an operator. The wider the window, the likelier it contains an unrelated
   * credit of exactly the same size — and identical amounts are ordinary here,
   * because every payment on a sale is its total divided by seven.
   *
   * The grace past the deadline is for a bank posting a transfer late, which is
   * the one honest reason this order's own money arrives after its window.
   */
  private expectationFor(sale: StoredSale, cardOrder: TmaSaleCardOrder): StatementExpectation {
    const graceMs = SALE_STATEMENT_LATE_CREDIT_GRACE_MINUTES * MINUTE_MS
    // The same bounds the checkpoint uses, from the same function. Two orders of
    // one sale are routinely the same size, so a window overlapping its
    // neighbour's could find that neighbour's credit and report this payment as
    // arrived when it never did — which is the direction that spends a seller's
    // stake for money they did not get.
    const window = windowForOrder(sale.cardOrders ?? [], cardOrder.orderId, graceMs) ?? {
      from: cardOrder.arrivedAt,
      to: new Date(cardOrder.confirmDeadlineAt.getTime() + graceMs)
    }

    return {
      // The four digits the sale recorded at creation. A statement for any
      // other account is refused before a row of it is read.
      cardTail: sale.payoutCardTail ?? '',
      amountKopecks: cardOrder.amount,
      ...window,
      // How far the document has to reach is **not** where the search ends —
      // the window's edge is normally still in the future when a seller is
      // asked for one. See {@link coverageRequiredTo}.
      mustCoverTo: coverageRequiredTo(window, new Date())
    }
  }

  /**
   * The order this statement is about, and the one extra thing that has to hold.
   *
   * Finding it and proving the caller owns it is `SaleCardOrderService`'s, not
   * restated here — it is the same lookup the Mini App and the bot make, and a
   * second copy of "may this person answer for this order" is the last rule to
   * keep in two places. What this adds is the condition only a statement has.
   */
  private async load(
    telegramId: number,
    saleId: string,
    orderId: number
  ): Promise<{ sale: StoredSale; cardOrder: TmaSaleCardOrder; answers: StatementSubject }> {
    const resolved = await this.cardOrders.resolve(telegramId, saleId, orderId)

    // Two questions a statement answers, and nothing else. Accepting one for
    // any other order would store somebody's whole transaction history for a
    // question nobody asked.
    //
    // The first is a denial: "this payment never arrived". The second is a
    // shortfall the seller declared and no statement has been through yet —
    // "₴995 arrived of ₴1 000" — which is the claim they gain by making, and the
    // reason their remainder is being held.
    const answersDenial = resolved.cardOrder.state === SaleCardOrderState.DISPUTED
    const answersShortfall = awaitsStatementCheckpoint({
      statementCheckpointAt: resolved.sale.statementCheckpointAt,
      cardOrders: [resolved.cardOrder]
    })

    if (!answersDenial && !answersShortfall)
      throw new ConflictException(ERROR.SALE_CARD.STATEMENT_NOT_REQUIRED)

    // A disputed order that also carries a declared figure is answered as a
    // denial: the dispute is the larger question, and settling it settles the
    // claim inside it.
    return {
      ...resolved,
      answers: answersDenial ? StatementSubject.DENIAL : StatementSubject.SHORTFALL
    }
  }

  /**
   * PDF and nothing else, and the extension decides.
   *
   * A statement is asked to prove a negative, which a screenshot cannot do —
   * see `SALE_STATEMENT_ALLOWED_EXTENSIONS`. Checked here as well as on the
   * interceptor: the first stops a phone streaming ten megabytes into memory,
   * the second holds for every caller.
   */
  private assertAcceptable(file: ReceiptFile): void {
    if (file.buffer.length > SALE_STATEMENT_MAX_BYTES)
      throw new PayloadTooLargeException(ERROR.SALE_CARD.STATEMENT_TOO_LARGE)

    if (!isAcceptedStatementFile({ fileName: file.fileName, mimeType: file.mimeType }))
      throw new BadRequestException(ERROR.SALE_CARD.STATEMENT_UNSUPPORTED_TYPE)
  }

  /** Two at once would race on one verdict, and one would overwrite the other. */
  private assertNothingInFlight(cardOrder: TmaSaleCardOrder): void {
    const busy = (cardOrder.statements ?? []).some((statement) =>
      (IN_FLIGHT as readonly SaleStatementStatus[]).includes(statement.status)
    )

    if (busy) throw new ConflictException(ERROR.SALE_CARD.STATEMENT_IN_FLIGHT)
  }

  private async reread(saleId: string, fallback: StoredSale): Promise<StoredSale> {
    return (await this.saleDbService.findById(saleId)) ?? fallback
  }
}
