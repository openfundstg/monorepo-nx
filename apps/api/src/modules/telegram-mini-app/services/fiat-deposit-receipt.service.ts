import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException
} from '@nestjs/common'
import {
  ERROR,
  FIAT_RECEIPT_MAX_BYTES,
  isFiatDepositPayable,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus,
  type TmaFiatDeposit
} from '@transacto/contracts'
import { Types } from 'mongoose'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import { FiatDepositSettlementService } from 'src/modules/telegram-mini-app/services/fiat-deposit-settlement.service'
import {
  assertOwnedFiatDeposit,
  toFiatDepositContract
} from 'src/modules/telegram-mini-app/utils'
import {
  ReceiptVerificationFacadeService,
  ReceiptVerificationOutcome,
  type ReceiptExpectation,
  type ReceiptVerification
} from 'src/modules/receipt-verification'
import type { PanelReceiptFile } from 'src/modules/transacto/interfaces'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import {
  TransactoPanelCheckParseStatus,
  type TransactoPanelCheckResponse
} from 'src/shared/interfaces/transacto-panel.interface'
import { describeError, isAcceptedReceiptFile, isEnabledFlag, receiptAmountToKopecks, withoutSignatureEnvelope } from 'src/shared/utils'
import environments from 'src/environments'

/**
 * How long a request waits for recognition before handing the receipt to the
 * reconciler.
 *
 * Recognition took about two seconds in every capture, so this is fifteen times
 * the observed cost — long enough that the ordinary case finishes inside the
 * request, short enough that a phone on a train is not left holding a socket.
 * Nothing is lost when it runs out: the receipt keeps its job id and the sweep
 * finishes it.
 */
const PARSE_WAIT_MS = 30_000

/**
 * Which rejection each way of failing verification is recorded as.
 *
 * A map rather than a `switch`, so a new outcome is a compile error at the one
 * place that has to answer for it instead of falling through to whatever the
 * default branch happened to be.
 *
 * Two outcomes are absent on purpose.
 * {@link ReceiptVerificationOutcome.CODE_NOT_FOUND} never reaches a receipt row
 * at all — it refuses the upload before one is created, so the user can try
 * again with a file a code can be read out of. And
 * {@link ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT} is not a refusal:
 * it goes upstream like any other verified receipt, marked as the weaker claim
 * it is.
 */
const REJECTION_BY_OUTCOME: Record<
  Exclude<
    ReceiptVerificationOutcome,
    | ReceiptVerificationOutcome.VERIFIED
    | ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
    | ReceiptVerificationOutcome.CODE_NOT_FOUND
  >,
  TmaFiatReceiptRejection
> = {
  [ReceiptVerificationOutcome.NOT_REGISTERED]: TmaFiatReceiptRejection.UNVERIFIED,
  [ReceiptVerificationOutcome.MISMATCHED]: TmaFiatReceiptRejection.MISMATCHED,
  [ReceiptVerificationOutcome.UNAVAILABLE]: TmaFiatReceiptRejection.VERIFIER_UNAVAILABLE
}

/**
 * Uploading a payment receipt against a fiat top-up.
 *
 * Three calls upstream, in a fixed order: the file goes up for recognition,
 * the job is polled, and only then is the result confirmed. That last call is
 * the write, and it is addressed **by payout with no job id** — the panel
 * confirms whatever it has parked against that payout — which is the reason
 * this service refuses a second upload while one is in flight. Two receipts in
 * flight on one payout would confirm whichever happened to be parked, attaching
 * one file's money under another file's name.
 *
 * What it deliberately does not do is decide that a top-up is paid. An accepted
 * receipt moves the coverage; whether the payout is *settled* is Transacto's
 * answer, read back by the reconciler, and a user's upload cannot cause a
 * balance to move.
 *
 * **Nothing is sent upstream until the state has vouched for it.** The receipt
 * code is verified against `check.gov.ua` first, and what then goes to Transacto
 * is the *bank's own* signed document for that code — never the file the user
 * uploaded. The upload is only ever evidence that somebody holds a receipt; a
 * screenshot is whatever an image editor made it, and the document behind a
 * verified code is published by the bank. Asking Transacto to catch a forged
 * receipt for us was the arrangement this replaced.
 */
@Injectable()
export class FiatDepositReceiptService {
  private readonly logger = new Logger(FiatDepositReceiptService.name)

  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly panelPayouts: TransactoPanelPayoutsApiService,
    private readonly settlement: FiatDepositSettlementService,
    private readonly verification: ReceiptVerificationFacadeService
  ) {}

  /**
   * The label every line about this top-up carries, in this service and in the
   * verification module below it.
   *
   * One receipt's progress crosses four services and two hosts, and without a
   * shared prefix a busy log interleaves several users' top-ups into something
   * nobody can follow. It is the top-up's own id because that is what an
   * operator is given when somebody complains.
   */
  private context(record: TmaFiatDepositRecord): string {
    return `[fiat ${record._id.toString()}]`
  }

  /** How often the recognition job is polled, in milliseconds. */
  private get pollIntervalMs(): number {
    return Number(environments.TMA_FIAT_PARSE_POLL_MS || '2000')
  }

  /**
   * Proves one receipt, forwards it, and waits briefly for Transacto's verdict.
   *
   * The order below is the whole design and is not an implementation detail:
   * the state service is asked first, and only a receipt it vouches for is ever
   * offered upstream — as the bank's own document rather than as the file that
   * arrived here.
   *
   * Returns the top-up as it stands afterwards — with the receipt accepted, or
   * rejected, or still being recognised. All three are ordinary answers, and
   * the client shows the difference rather than being made to wait for it.
   */
  async submit(
    telegramId: number,
    depositId: string,
    file: PanelReceiptFile
  ): Promise<TmaFiatDeposit> {
    const record = assertOwnedFiatDeposit(
      await this.fiatDepositDb.findById(depositId),
      telegramId
    )

    if (!isFiatDepositPayable(record.status))
      throw new ConflictException(ERROR.FIAT_DEPOSIT.NOT_PAYABLE)

    // The deadline is the deadline. It used to be advisory — the payout was
    // held past it so a late receipt still landed — and what that bought was
    // receipts for transfers made long after the rate was frozen. Somebody who
    // paid and missed it appeals instead, and a person decides.
    if (record.payDeadlineAt.getTime() < Date.now())
      throw new ConflictException(ERROR.FIAT_DEPOSIT.PAY_WINDOW_CLOSED)

    this.assertAcceptable(file)
    await this.assertNothingInFlight(record)

    this.logger.log(
      `${this.context(record)} receipt upload started: ${file.buffer.byteLength} bytes of ` +
        `${file.mimeType || 'an unstated type'}, against payout ${record.payoutId} — ` +
        `${record.amountUah - record.coveredUah} kopecks outstanding of ${record.amountUah}`
    )

    // **The file goes to verification exactly as it arrived**, envelope and
    // all. A receipt saved straight out of a banking app is a PKCS#7 container,
    // and monobank's check is of the qualified signature over those precise
    // bytes — unwrapping first would hand it a document it must refuse. The
    // facade unwraps for reading and keeps the original for the signature.
    const verified = await this.verify(record, file)

    // Before the receipt row, not after it. A file no code can be read out of
    // has not been judged — it has not been *read* — and recording a refusal
    // for it would close a top-up whose payout is still perfectly payable.
    if (verified?.outcome === ReceiptVerificationOutcome.CODE_NOT_FOUND)
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.RECEIPT_CODE_UNREADABLE)

    const receiptId = await this.fiatDepositDb.pushReceipt(depositId, {
      uploadedAt: new Date(),
      upstreamJobId: null,
      recipientChecked:
        verified?.outcome !== ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
    })

    if (
      verified !== null &&
      verified.outcome !== ReceiptVerificationOutcome.VERIFIED &&
      verified.outcome !== ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
    )
      return this.reject(record, receiptId, REJECTION_BY_OUTCOME[verified.outcome])

    // Only the *fallback* needs unwrapping: Transacto's recognition reads a PDF
    // and makes nothing of a signed container. A verified receipt is forwarded
    // as whatever its verifier vouched for, which is already a document.
    const outgoing = await this.outgoingFile(record, verified, this.readable(file, record))

    this.logger.log(
      `${this.context(record)} sending ${outgoing.fileName} (${outgoing.buffer.byteLength} bytes) ` +
        `to Transacto payout ${record.payoutId}`
    )

    const uploaded = await this.panelPayouts
      .uploadCheck(record.payoutId, outgoing)
      .catch((error: unknown) => {
        this.logger.error(`[fiat ${depositId}] receipt upload failed: ${describeError(error)}`)
        return null
      })

    if (uploaded === null)
      return this.reject(record, receiptId, TmaFiatReceiptRejection.PARSE_FAILED)

    return this.settle(record, receiptId, uploaded)
  }

  /**
   * Whether this receipt is a real payment, and this payout's.
   *
   * `null` means the check did not run at all, which is a deployment state and
   * not a verdict: the sidecar that drives `check.gov.ua` is a separate
   * container, and a workspace without one would otherwise send every top-up to
   * an operator. Guarded exactly as the proxy pool is — `RECEIPT_VERIFICATION_REQUIRED`
   * turns a missing verifier into a refusal, so a developer runs without one
   * while production refuses to.
   */
  private async verify(
    record: TmaFiatDepositRecord,
    file: PanelReceiptFile
  ): Promise<ReceiptVerification | null> {
    if (!this.verification.isConfigured) {
      if (isEnabledFlag(environments.RECEIPT_VERIFICATION_REQUIRED))
        throw new ServiceUnavailableException(ERROR.FIAT_DEPOSIT.RECEIPT_VERIFIER_UNAVAILABLE)

      this.logger.warn(
        `[fiat ${record._id.toString()}] no receipt verifier configured — ` +
          'the receipt is going to Transacto unverified'
      )

      return null
    }

    const verification = await this.verification.verify(
      file,
      this.expectation(record),
      this.context(record)
    )

    if (verification.outcome === ReceiptVerificationOutcome.VERIFIED) {
      this.logger.log(
        `[fiat ${record._id.toString()}] receipt ${verification.receipt.code} verified ` +
          `from ${verification.source}`
      )
    }

    // Warn, not log. It goes upstream, and it goes on three checks instead of
    // four — the one line that says so is the only trace an operator has if the
    // top-up is ever disputed.
    if (verification.outcome === ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT) {
      this.logger.warn(
        `[fiat ${record._id.toString()}] receipt ${verification.receipt.code} goes to Transacto ` +
          'with its recipient unchecked — neither side states it in a comparable form'
      )
    }

    return verification
  }

  /**
   * What this top-up requires of a receipt.
   *
   * The amount is what is **still outstanding**, not the payout's full figure.
   * They are the same for the ordinary top-up, settled by one transfer, and
   * differ once a receipt has been accepted — where insisting on the full amount
   * would refuse the second half of a payment this product itself invited by
   * counting coverage.
   *
   * The window opens when the payout was reserved. There is no grace before it:
   * a transfer dated earlier is not clock skew, it is an older payment being
   * presented for a payout that did not exist when it was made.
   */
  private expectation(record: TmaFiatDepositRecord): ReceiptExpectation {
    return {
      amountUah: record.amountUah - record.coveredUah,
      recipientCard: record.recipientCard,
      paidNotBefore: record.createdAt,
      paidNotAfter: record.payDeadlineAt
    }
  }

  /**
   * The file that actually goes to Transacto.
   *
   * The bank's own signed document whenever there is one, and the user's upload
   * only when there is not. A verified code whose document cannot be fetched is
   * still a proven payment — the bank being unreachable is not evidence against
   * the person who paid — so it falls back rather than refusing, and says so.
   */
  private async outgoingFile(
    record: TmaFiatDepositRecord,
    verified: ReceiptVerification | null,
    uploaded: PanelReceiptFile
  ): Promise<PanelReceiptFile> {
    if (
      verified?.outcome !== ReceiptVerificationOutcome.VERIFIED &&
      verified?.outcome !== ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
    )
      return uploaded

    const official = await this.verification.officialDocument(
      verified.receipt,
      this.context(record)
    )

    if (official === null) {
      this.logger.warn(
        `[fiat ${record._id.toString()}] receipt ${verified.receipt.code} is verified but its ` +
          "bank document could not be fetched — forwarding the user's own file"
      )

      return uploaded
    }

    return official
  }

  /**
   * Carries one receipt from whatever the panel last said to a final answer.
   *
   * Shared by the upload path and the sweep that picks up receipts left
   * recognising, so a receipt finished by a background pass is recorded exactly
   * as one finished inside the request.
   */
  async settle(
    record: TmaFiatDepositRecord,
    receiptId: Types.ObjectId,
    response: TransactoPanelCheckResponse
  ): Promise<TmaFiatDeposit> {
    const resolved = await this.awaitRecognition(record, receiptId, response)

    if (resolved === null) {
      // Still recognising when the wait ran out. Left as it is on purpose: the
      // job id is stored, the sweep will finish it, and rejecting a receipt
      // that upstream may yet accept would be the one wrong answer here.
      return toFiatDepositContract(await this.reread(record))
    }

    if (resolved.status === TransactoPanelCheckParseStatus.PREVIEW)
      return this.confirm(record, receiptId)

    if (resolved.status === TransactoPanelCheckParseStatus.OK)
      return this.accept(record, receiptId, resolved)

    this.logger.warn(
      `[fiat ${record._id.toString()}] receipt refused upstream: ` +
        `${resolved.error_message ?? resolved.status}`
    )

    return this.reject(record, receiptId, TmaFiatReceiptRejection.NOT_ACCEPTED)
  }

  /**
   * Polls until recognition finishes, or gives up and says so with `null`.
   *
   * The first response is passed in rather than fetched, because the upload
   * itself already carries one — either the job to poll or the answer.
   */
  private async awaitRecognition(
    record: TmaFiatDepositRecord,
    receiptId: Types.ObjectId,
    first: TransactoPanelCheckResponse
  ): Promise<TransactoPanelCheckResponse | null> {
    if (first.status !== TransactoPanelCheckParseStatus.PARSING) return first

    const jobId = first.job_id
    if (jobId === undefined) {
      // `parsing` without a job is a state the caller cannot leave: there is
      // nothing to poll and nothing to confirm.
      this.logger.error(`[fiat ${record._id.toString()}] upstream is parsing with no job id`)
      return null
    }

    await this.fiatDepositDb.markReceiptParsing(record._id.toString(), receiptId, jobId)

    const deadline = Date.now() + PARSE_WAIT_MS

    while (Date.now() < deadline) {
      await this.pause()

      const polled = await this.panelPayouts
        .getCheckParseStatus(record.payoutId, jobId)
        .catch((error: unknown) => {
          this.logger.error(`[fiat ${record._id.toString()}] parse poll failed: ${describeError(error)}`)
          return null
        })

      if (polled === null) continue
      if (polled.status !== TransactoPanelCheckParseStatus.PARSING) return polled
    }

    return null
  }

  /** Confirms a recognised receipt — the call that actually attaches it. */
  private async confirm(
    record: TmaFiatDepositRecord,
    receiptId: Types.ObjectId
  ): Promise<TmaFiatDeposit> {
    const confirmed = await this.panelPayouts
      .confirmCheck(record.payoutId)
      .catch((error: unknown) => {
        this.logger.error(
          `[fiat ${record._id.toString()}] receipt confirmation failed: ${describeError(error)}`
        )
        return null
      })

    if (confirmed?.status !== TransactoPanelCheckParseStatus.OK) {
      return this.reject(record, receiptId, TmaFiatReceiptRejection.NOT_ACCEPTED)
    }

    return this.accept(record, receiptId, confirmed)
  }

  /**
   * Records an accepted receipt and the hryvnia it brought.
   *
   * The amount is **Transacto's**, off `checkData`, not anything read here: the
   * payout settles against the figure they recognised, and counting our own
   * would let a top-up look covered while they still consider it open.
   */
  private async accept(
    record: TmaFiatDepositRecord,
    receiptId: Types.ObjectId,
    response: TransactoPanelCheckResponse
  ): Promise<TmaFiatDeposit> {
    const total = response.checkData?.parsed_fields?.total_amount
    const amountUah = total === undefined ? null : receiptAmountToKopecks(total)

    if (amountUah === null) {
      this.logger.error(
        `[fiat ${record._id.toString()}] upstream accepted a receipt with no readable amount`
      )
      return this.reject(record, receiptId, TmaFiatReceiptRejection.NOT_ACCEPTED)
    }

    const updated = await this.fiatDepositDb.markReceiptAccepted(record._id.toString(), receiptId, {
      amountUah,
      checkUrl: null,
      // Never COMPLETED from here. Coverage is arithmetic; settlement is
      // Transacto's word, and the reconciler is where that word is read.
      status: TmaFiatDepositStatus.PARTIALLY_PAID
    })

    if (updated !== null) {
      this.logger.log(
        `[fiat ${record._id.toString()}] receipt accepted for ${amountUah} kopecks; ` +
          `covered ${updated.coveredUah} of ${updated.amountUah}`
      )
    }

    return this.published(record, updated)
  }

  /**
   * Records the refusal and stops the top-up.
   *
   * A rejected receipt used to leave the top-up open for another try, which
   * read as "upload something else" — and what a user does then is transfer
   * again. It goes to an operator instead: the payout stays ours, because a
   * receipt Transacto would not attach is not evidence that no money moved, and
   * the person who paid keeps their claim on it.
   *
   * The reason is still stored on the receipt. It is not shown to the user —
   * "the receipt did not pass moderation" is the whole of what they can act on,
   * and the three reasons behind it are an operator's business.
   */
  private async reject(
    record: TmaFiatDepositRecord,
    receiptId: Types.ObjectId,
    rejection: TmaFiatReceiptRejection
  ): Promise<TmaFiatDeposit> {
    const updated = await this.fiatDepositDb.markReceiptRejected(
      record._id.toString(),
      receiptId,
      rejection
    )

    this.logger.warn(
      `[fiat ${record._id.toString()}] receipt rejected (${rejection}); handing it to an operator`
    )

    // `review` announces the new state itself, so the fallback below is only
    // for the race where the row closed underneath us.
    const flagged = await this.settlement.review(updated ?? record)

    return flagged === null
      ? this.published(record, updated)
      : toFiatDepositContract(flagged)
  }

  /**
   * The top-up as it now stands, announced if this write is what moved it.
   *
   * Both endings need the same three things — fall back to the stored row when
   * the update did not apply, tell the user when it did, and answer with the
   * contract shape — and a copy each is a copy that can forget to announce.
   */
  private async published(
    record: TmaFiatDepositRecord,
    updated: TmaFiatDepositRecord | null
  ): Promise<TmaFiatDeposit> {
    if (updated === null) return toFiatDepositContract(await this.reread(record))

    this.settlement.announce(updated)

    return toFiatDepositContract(updated)
  }

  /**
   * The receipt as bytes Transacto can read.
   *
   * A bank serves its own receipt signed: `api.monobank.ua` answers
   * `Content-Type: application/pdf` and sends a PKCS#7 container with the PDF
   * encapsulated inside it, and a user who saved that file and uploaded it is
   * uploading the container. Their recognition reports one as an unreadable
   * file, in the one way that looks like the user's fault. Anything else passes
   * through untouched — a screenshot has nothing to unwrap.
   *
   * **Only the forwarding path uses this.** Verification is handed the original,
   * because monobank's check is of the signature over those exact bytes, and
   * this method would destroy the thing being checked.
   */
  private readable(file: PanelReceiptFile, record: TmaFiatDepositRecord): PanelReceiptFile {
    const document = withoutSignatureEnvelope(file)

    if (document !== file) {
      this.logger.log(
        `${this.context(record)} receipt arrived as a signed container; forwarding the ` +
          `${document.buffer.byteLength} bytes inside it rather than the ` +
          `${file.buffer.byteLength} it came in`
      )
    }

    return document
  }

  /**
   * Refuses a file the panel would refuse anyway.
   *
   * Locally, because the alternative is a phone uploading ten megabytes over
   * mobile data to be told it was the wrong kind of file.
   */
  private assertAcceptable(file: PanelReceiptFile): void {
    if (!isAcceptedReceiptFile(file))
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.RECEIPT_UNSUPPORTED_TYPE)

    if (file.buffer.byteLength > FIAT_RECEIPT_MAX_BYTES)
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.RECEIPT_TOO_LARGE)
  }

  /**
   * Refuses a second receipt while one is being recognised.
   *
   * Asked of both sides, and they answer different questions. Our own row knows
   * about a receipt this system is waiting on; the panel knows about one parked
   * against the payout — including one left there by a request that died before
   * it could be confirmed.
   */
  private async assertNothingInFlight(record: TmaFiatDepositRecord): Promise<void> {
    const parsingHere = record.receipts.some(
      (receipt) => receipt.status === TmaFiatReceiptStatus.PARSING
    )
    if (parsingHere) throw new ConflictException(ERROR.FIAT_DEPOSIT.RECEIPT_IN_FLIGHT)

    const upstream = await this.panelPayouts
      .getActiveCheckParse(record.payoutId)
      .catch((error: unknown) => {
        this.logger.error(
          `[fiat ${record._id.toString()}] could not ask upstream about a running parse: ` +
            describeError(error)
        )
        return null
      })

    if (upstream?.status === TransactoPanelCheckParseStatus.PARSING)
      throw new ConflictException(ERROR.FIAT_DEPOSIT.RECEIPT_IN_FLIGHT)
  }

  /** The row as stored, for the cases where an update did not apply. */
  private async reread(record: TmaFiatDepositRecord): Promise<TmaFiatDepositRecord> {
    return (await this.fiatDepositDb.findById(record._id.toString())) ?? record
  }

  private pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
  }
}
