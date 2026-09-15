import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import Redis from 'ioredis'
import { Cron, CronExpression } from '@nestjs/schedule'
import {
  isFiatDepositPayable,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus
} from '@transacto/contracts'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import { FiatDepositReceiptService } from 'src/modules/telegram-mini-app/services/fiat-deposit-receipt.service'
import { FiatDepositSettlementService } from 'src/modules/telegram-mini-app/services/fiat-deposit-settlement.service'
import type {
  TmaFiatDepositReceiptRecord,
  TmaFiatDepositRecord
} from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import {
  TransactoPanelCheckParseStatus,
  TransactoPayoutStatus
} from 'src/shared/interfaces/transacto-panel.interface'
import { describeError, panelAmountToKopecks } from 'src/shared/utils'
import { REDIS_CLIENT } from 'src/shared/redis'
import { RedisKeys } from 'src/shared/redis/redis.keys'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaFiatDepositStuckEvent } from 'src/shared/interfaces'

const MINUTE_MS = 60 * 1000

/**
 * How long a receipt may sit in recognition before this service touches it.
 *
 * An upload in flight has a receipt in PARSING for a second or two before its
 * job id is stored, and a sweep that grabbed it would race the request that
 * created it. Two minutes is far longer than that window and far shorter than
 * the hold.
 */
const RECEIPT_SETTLE_AFTER_MS = 2 * MINUTE_MS

/**
 * How long recognition may run before the receipt is called lost.
 *
 * Ten times the hold's own patience for the ordinary case. Past this, the job
 * is not coming back, and a receipt stuck in PARSING would keep the user from
 * uploading another one — which is the actual harm.
 */
const RECEIPT_TIMEOUT_MS = 10 * MINUTE_MS

/**
 * The longest a top-up may hold a Transacto payout, whatever it is doing.
 *
 * Measured from the top-up's own start, because that is when the payout was
 * taken and when Transacto's clock started. The ordinary path is far shorter —
 * fifteen minutes to pay, thirty before an unpaid hold is given back — and this
 * is the backstop for the paths that used to have none: a top-up under review
 * sat outside every sweep here and was held until a person noticed. One lasted
 * seventeen hours.
 *
 * Ninety minutes is the figure the business chose. Worth knowing when reading
 * it: Transacto's own bot raised a critical breach on a payout held ninety-five
 * minutes, so this leaves very little margin — if their alerts start earlier
 * than that, this number is the thing to lower.
 */
const FIAT_DEPOSIT_MAX_HOLD_MS = 90 * MINUTE_MS

/**
 * How long a top-up may be held before an operator is told about it.
 *
 * Earlier than the cap, because the cap does not apply to the case this warns
 * about: a review with money in its payout is never released automatically, so
 * without somebody being told it is held until they happen to look. That is how
 * one sat for seventeen hours.
 *
 * Nothing is said about a top-up that will free itself at ninety minutes —
 * telling an operator about a problem that fixes itself is how alerts come to
 * be ignored.
 */
const OPERATOR_ALERT_AFTER_MS = 30 * MINUTE_MS

/**
 * How often the same stuck top-up is announced.
 *
 * It repeats rather than firing once because the first message arrives at
 * whatever hour it arrives, and the thing it reports does not go away on its
 * own. It repeats no faster than this because a channel that says the same
 * thing every thirty seconds is a channel nobody reads.
 */
const OPERATOR_ALERT_EVERY_MS = 5 * MINUTE_MS

/**
 * Everything about a fiat top-up that happens without a user doing anything.
 *
 * Four passes, in this order and for a reason. Receipts left recognising are
 * finished first, because a receipt that lands changes what the rest should do.
 * Then Transacto is asked which payouts it has executed — **this is the only
 * place in the product where a fiat top-up credits a balance**, and it credits
 * on their word rather than on our arithmetic. Then holds that have run out are
 * given back, and last the reviews are swept.
 *
 * That order is load-bearing at both ends. The settlement pass runs before
 * either release pass, so a payout Transacto has already executed is credited
 * rather than handed back; and it covers **every top-up whose payout is still
 * ours**, review included, because their word does not stop counting the moment
 * our own receipt reader gives up on a document.
 *
 * The rule that shapes the last two passes: a payout with nothing paid into it
 * is released automatically, and a payout with *anything* paid into it never
 * is. Handing back a payout somebody has already transferred to would give a
 * stranger their money and leave us with nothing to show them — so that case
 * stops and waits for a person, which is what
 * {@link TmaFiatDepositStatus.REVIEW} is for.
 *
 * **Waiting for a person is not the same as waiting for ever**, and it used to
 * be. A top-up under review sat outside every pass here, so its payout stayed
 * ours until somebody noticed — one was held seventeen hours, and Transacto
 * fines the delay. Two passes closed that, at the two opposite endings a review
 * can have. {@link sweepReviews} handles the empty one: after ninety minutes it
 * re-asks the panel what has actually been paid into the payout and gives back
 * the ones the panel says are empty. {@link settleAgainstHistory} handles the
 * paid one: a payout somebody settled in the panel — support, checking by hand
 * a receipt we refused — is credited to the user it was held for, without
 * waiting for an operator to notice. The rule above is unchanged; it is now
 * applied to a fresh answer instead of a frozen one, and on a deadline.
 */
@Injectable()
export class FiatDepositReconcileService {
  private readonly logger = new Logger(FiatDepositReconcileService.name)

  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly panelPayouts: TransactoPanelPayoutsApiService,
    private readonly receipts: FiatDepositReceiptService,
    private readonly settlement: FiatDepositSettlementService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * Never throws, and costs nothing when nothing is running: with no top-up
   * held at all it does not talk to the panel, which is most of the night.
   *
   * A held one costs more than it did — the history table is now read on every
   * pass a review exists for, not only while something is live. That is the
   * price of noticing a payout settled outside our own path within thirty
   * seconds instead of whenever somebody looks, and a review is rare.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcile(): Promise<void> {
    try {
      // One read, two working sets: held is live plus the reviews, by
      // construction, and `isFiatDepositPayable` is the definition of the
      // narrower one. Two queries would be two chances for them to disagree —
      // and a second full pass over a collection that only grows, every thirty
      // seconds, for the life of the process.
      const held = await this.fiatDepositDb.findHeld()
      const live = held.filter((record) => isFiatDepositPayable(record.status))

      await this.finishStuckReceipts(live)

      // Over `held`, not `live`, and that is what this pass is for now: the
      // payout behind a top-up under review is still ours and can still be
      // executed upstream — by support settling it in the panel, which is
      // exactly the case our own verification failing produces.
      await this.settleAgainstHistory(held)

      if (live.length > 0) await this.sweepHolds()

      // Last, so a payout Transacto has already executed is credited before
      // this pass can consider handing it back.
      await this.sweepReviews()
    } catch (error: unknown) {
      this.logger.error(`Fiat top-up reconciliation failed: ${describeError(error)}`)
    }
  }

  /**
   * Collects verdicts for receipts whose own request did not wait for them.
   *
   * Only receipts past the grace period are touched: an upload in flight has a
   * receipt in PARSING for a second or two before its job id is stored, and a
   * sweep that grabbed one would race the request that created it.
   */
  private async finishStuckReceipts(live: readonly TmaFiatDepositRecord[]): Promise<void> {
    const cutoff = Date.now() - RECEIPT_SETTLE_AFTER_MS

    for (const record of live) {
      const stuck = record.receipts.filter(
        (receipt) =>
          receipt.status === TmaFiatReceiptStatus.PARSING &&
          receipt.uploadedAt.getTime() < cutoff
      )

      for (const receipt of stuck) await this.finishStuckReceipt(record, receipt)
    }
  }

  /**
   * One abandoned receipt, carried to whatever answer it has.
   *
   * Three endings, and the order they are checked in is the argument for having
   * them in one place:
   *
   * - **No job id** — the upload itself failed after the row was written, so
   *   there is nothing to poll and nothing will ever come. Closed as a failure
   *   rather than left to block the user's next upload.
   * - **Still recognising** — left alone until it is old enough to call lost.
   *   Rejecting a receipt upstream may yet accept is the one wrong answer here.
   * - **Anything else** — an answer arrived while nobody was listening, and it
   *   is recorded through the same path a waiting request would have used.
   */
  private async finishStuckReceipt(
    record: TmaFiatDepositRecord,
    receipt: TmaFiatDepositReceiptRecord
  ): Promise<void> {
    const depositId = record._id.toString()

    if (receipt.upstreamJobId === null) {
      await this.fiatDepositDb.markReceiptRejected(
        depositId,
        receipt._id,
        TmaFiatReceiptRejection.PARSE_FAILED
      )
      return
    }

    const polled = await this.panelPayouts
      .getCheckParseStatus(record.payoutId, receipt.upstreamJobId)
      .catch((error: unknown) => {
        this.logger.error(`[fiat ${depositId}] parse poll failed in sweep: ${describeError(error)}`)
        return null
      })

    if (polled === null) return

    if (polled.status !== TransactoPanelCheckParseStatus.PARSING) {
      await this.receipts.settle(record, receipt._id, polled)
      return
    }

    if (receipt.uploadedAt.getTime() >= Date.now() - RECEIPT_TIMEOUT_MS) return

    this.logger.warn(`[fiat ${depositId}] recognition never finished; releasing the slot`)
    await this.fiatDepositDb.markReceiptRejected(
      depositId,
      receipt._id,
      TmaFiatReceiptRejection.TIMED_OUT
    )
  }

  /**
   * Asks Transacto which payouts are done, and credits the ones that are.
   *
   * The history table is the only place a payout states that it was executed —
   * a row leaving the active table has been completed, released or refused, and
   * only this says which.
   *
   * **Held, not live**, and that is the whole of this pass's reach. Our own
   * verification is not the only way a payout gets settled: when it refuses a
   * receipt the user takes it to support, support checks it themselves and
   * uploads it through Transacto's own panel, and the payout closes upstream
   * with our row still saying REVIEW. Nothing read the history for such a row,
   * so the person who had actually transferred their hryvnia was credited only
   * when an operator noticed and pressed a button — one waited three hours, and
   * three top-ups in a single night were closed by hand.
   *
   * Widening it credits nobody twice. `markCompleted` writes before
   * `complete` credits and matches only a row still held, so two passes seeing
   * the same executed payout produce one credit; the ledger entry is `once`
   * besides. And the evidence is the same evidence a live top-up is credited
   * on — Transacto's own word that the money reached the recipient — which does
   * not become weaker because our receipt reader gave up on the document.
   */
  private async settleAgainstHistory(held: readonly TmaFiatDepositRecord[]): Promise<void> {
    if (held.length === 0) return

    const { rows } = await this.panelPayouts.getPayoutHistory()
    const upstream = new Map(rows.map((row) => [row.id, row.status]))

    for (const record of held) {
      const status = upstream.get(record.payoutId)

      if (status === TransactoPayoutStatus.COMPLETED) {
        if (record.status === TmaFiatDepositStatus.REVIEW) {
          this.logger.log(
            `[fiat ${record._id.toString()}] payout ${record.payoutId} was executed upstream ` +
              `while the top-up was under review — somebody settled it in the panel. Crediting.`
          )
        }

        await this.settlement.complete(record)
        continue
      }

      if (status === TransactoPayoutStatus.FAILED) {
        // Refused upstream while we hold receipts against it. Nobody can be
        // credited and nothing can be released — a person has to look.
        //
        // Reported on the transition rather than on every pass that sees it.
        // `review` returns the row only when it actually moved one — a top-up
        // already under review matches nothing and answers `null` — so the
        // escalation is logged once instead of once every thirty seconds, and
        // this reads no statuses to know that.
        const flagged = await this.settlement.review(record)
        if (flagged === null) continue

        this.logger.error(
          `[fiat ${record._id.toString()}] payout ${record.payoutId} was refused upstream ` +
            `with ${record.coveredUah} kopecks covered`
        )
      }
    }
  }


  /**
   * Gives back the holds that have run out — and refuses to give back the ones
   * that have money in them.
   */
  private async sweepHolds(): Promise<void> {
    const due = await this.fiatDepositDb.findDueForRelease(new Date())

    for (const record of due) {
      const recognising = record.receipts.some(
        (receipt) => receipt.status === TmaFiatReceiptStatus.PARSING
      )

      // A receipt still being recognised may yet cover this payout. The next
      // pass decides, once there is an answer to decide on.
      if (recognising) continue

      if (record.coveredUah > 0) {
        this.logger.warn(
          `[fiat ${record._id.toString()}] hold ran out with ${record.coveredUah} of ` +
            `${record.amountUah} kopecks covered — holding the payout for an operator`
        )
        await this.settlement.review(record)
        continue
      }

      await this.settlement.release(record, TmaFiatDepositStatus.EXPIRED)
    }
  }

  /**
   * Gives back the payouts behind reviews nobody has paid into.
   *
   * A top-up under review takes no receipts, is not swept for release, and its
   * `coveredUah` stops being maintained. That was deliberate for the money and
   * accidental for the payout: the hold simply never ended, and Transacto
   * charges for holding one. {@link settleAgainstHistory} now covers the other
   * ending — a payout somebody settled in the panel — so between them a review
   * has two ways out that do not need a person.
   *
   * **The panel is asked again rather than trusted from memory.** `coveredUah`
   * is our tally of receipts Transacto accepted, frozen at the moment the row
   * was flagged; the checks table is Transacto's own statement of what has been
   * paid into a payout, which is the figure the counterparty settles against. A
   * transfer that landed after the review began appears in the second and never
   * in the first, and releasing on the first would hand away money somebody had
   * actually sent.
   *
   * So the fresh answer decides, both ways: nothing recognised releases the
   * payout, and anything recognised writes the real figure onto the record and
   * keeps holding — the operator now sees what arrived instead of a stale zero.
   *
   * An unreadable checks table releases nothing. `parsePanelCheckRows` counts
   * the rows it could not read and the API service logs them; a table that
   * stopped parsing looks exactly like a table with no receipts in it, and that
   * mistake would be paid for by the person who transferred the money.
   */
  private async sweepReviews(): Promise<void> {
    const stale = await this.fiatDepositDb.findReviewsOlderThan(
      new Date(Date.now() - OPERATOR_ALERT_AFTER_MS)
    )
    if (stale.length === 0) return

    const { rows, unreadable } = await this.panelPayouts.getChecks()

    if (unreadable > 0) {
      this.logger.error(
        `${unreadable} receipt row(s) could not be read from the panel; releasing no payout ` +
          `this pass — an unreadable table and an empty one look the same here`
      )
      return
    }

    const covered = new Map<number, number>()
    for (const row of rows) {
      const kopecks = panelAmountToKopecks(row.amount)
      if (kopecks === null) continue

      covered.set(row.payout_id, (covered.get(row.payout_id) ?? 0) + kopecks)
    }

    const now = Date.now()

    for (const record of stale) {
      const upstream = covered.get(record.payoutId) ?? 0
      const heldForMs = now - record.createdAt.getTime()

      if (upstream > 0) {
        await this.holdAndAnnounce(record, upstream, heldForMs)
        continue
      }

      // Empty, and out of time. The one case that frees itself.
      if (heldForMs < FIAT_DEPOSIT_MAX_HOLD_MS) continue

      this.logger.log(
        `[fiat ${record._id.toString()}] payout ${record.payoutId} has been held ` +
          `${Math.round(heldForMs / MINUTE_MS)} minutes with nothing paid into it; ` +
          `giving it back to the book`
      )
      await this.settlement.release(record, TmaFiatDepositStatus.EXPIRED)
    }
  }

  /**
   * Keeps a payout somebody has paid into, and makes sure a person hears about it.
   *
   * This is the case with no automatic ending, and that is deliberate: handing
   * back a payout somebody has transferred to gives a stranger their money and
   * leaves us nothing to show them. So the ninety-minute cap does not apply
   * here — what applies instead is that an operator is told, and told again
   * every five minutes until they act.
   *
   * The figure is written to the record on the way past. `coveredUah` stops
   * being maintained the moment a top-up is flagged, so an operator opening the
   * panel would otherwise read a zero while the panel itself says otherwise.
   */
  private async holdAndAnnounce(
    record: TmaFiatDepositRecord,
    coveredUah: number,
    heldForMs: number
  ): Promise<void> {
    const depositId = record._id.toString()

    if (coveredUah !== record.coveredUah) {
      await this.fiatDepositDb.setCoveredFromUpstream(depositId, coveredUah)
      this.logger.warn(
        `[fiat ${depositId}] payout ${record.payoutId} is under review with ${coveredUah} ` +
          `kopecks paid in — our tally said ${record.coveredUah}. Still held.`
      )
    }

    if (!(await this.shouldAnnounce(depositId))) return

    this.eventEmitter.emit(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STUCK, {
      depositId,
      payoutId: record.payoutId,
      telegramId: record.telegramId,
      amountUah: record.amountUah,
      coveredUah,
      heldForMinutes: Math.round(heldForMs / MINUTE_MS)
    } satisfies TmaFiatDepositStuckEvent)
  }

  /**
   * Whether this top-up has gone long enough without being announced.
   *
   * `SET NX PX` rather than a timestamp we compare ourselves: the reconciler is
   * one process today and the answer has to stay one answer if it ever is not.
   * A Redis outage answers "no", which loses an alert rather than sending the
   * same one thirty seconds apart — the log line above it is written either way.
   */
  private async shouldAnnounce(depositId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.set(
        RedisKeys.FiatDeposit.stuckAnnounced(depositId),
        '1',
        'PX',
        OPERATOR_ALERT_EVERY_MS,
        'NX'
      )

      return claimed === 'OK'
    } catch (error: unknown) {
      this.logger.error(`Could not throttle the stuck-top-up alert: ${describeError(error)}`)

      return false
    }
  }
}
