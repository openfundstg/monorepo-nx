import { Injectable, Logger } from '@nestjs/common'
import { TmaFiatDepositStatus, BalanceEntryKind } from '@transacto/contracts'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import { describeError } from 'src/shared/utils'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'

/**
 * The four things that can happen to a reserved payout, and the only place any
 * of them happens.
 *
 * Extracted because three callers need them and they must not become three
 * settlement paths for the same money: the reconciler acts on Transacto's word,
 * the Mini App acts on the user's, and the admin panel acts on an operator's —
 * but *what* it means to complete or release a top-up cannot depend on who
 * asked. The panel's own rule says as much: every write it makes delegates to
 * the service that already owns that operation.
 *
 * Each transition is conditional on the top-up still being live, and each
 * returns `null` when it was not. That is not defensive coding — it is how the
 * double credit is prevented: the caller pays only when its own write applied.
 */
@Injectable()
export class FiatDepositSettlementService {
  private readonly logger = new Logger(FiatDepositSettlementService.name)

  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly panelPayouts: TransactoPanelPayoutsApiService,
    private readonly tmaGateway: TmaGateway,
    private readonly balanceLedger: BalanceLedgerService
  ) {}

  /** Pushes a top-up's state to the user's screen, and to whoever else listens. */
  announce(record: TmaFiatDepositRecord): void {
    this.tmaGateway.emitFiatDepositStatusChange(record.telegramId, {
      depositId: record._id.toString(),
      status: record.status,
      coveredUah: record.coveredUah
    })
  }

  /**
   * Closes a top-up as paid and credits the frozen USDT.
   *
   * `null` when the row had already been closed by somebody else, in which case
   * nothing is credited — that condition *is* the guard against paying a user
   * twice for one transfer.
   */
  async complete(record: TmaFiatDepositRecord): Promise<TmaFiatDepositRecord | null> {
    const completed = await this.fiatDepositDb.markCompleted(record._id.toString(), new Date())
    if (completed === null) return null

    const balance = await this.balanceLedger.credit(
      completed.telegramId,
      completed.cryptoCents,
      {
        kind: BalanceEntryKind.FIAT_DEPOSIT,
        sourceId: completed._id.toString(),
        // `markCompleted` is what stops a second credit; this stops a second
        // entry if one ever gets past it.
        once: true
      }
    )

    this.logger.log(
      `[fiat ${completed._id.toString()}] completed: credited ${completed.cryptoCents / 100} ` +
        `USDT to telegramId ${completed.telegramId}, new balance ${balance / 100} USDT`
    )

    this.announce(completed)
    this.tmaGateway.emitBalanceUpdated(completed.telegramId, balance)

    return completed
  }

  /**
   * Hands the payout back to Transacto and closes the top-up.
   *
   * The upstream release comes first and its failure stops the whole thing: a
   * row marked released while the payout is still held upstream is a payout
   * nothing is watching any more, and the next sweep would not find it either.
   */
  async release(
    record: TmaFiatDepositRecord,
    status: TmaFiatDepositStatus.EXPIRED | TmaFiatDepositStatus.CANCELLED
  ): Promise<TmaFiatDepositRecord | null> {
    const released = await this.panelPayouts
      .releasePayout(record.payoutId)
      .catch((error: unknown) => {
        this.logger.error(
          `[fiat ${record._id.toString()}] could not release payout ${record.payoutId}: ` +
            describeError(error)
        )
        return null
      })

    if (released === null) return null

    const closed = await this.fiatDepositDb.markReleased(
      record._id.toString(),
      status,
      new Date()
    )
    if (closed === null) return null

    this.logger.log(
      `[fiat ${closed._id.toString()}] ${status}; payout ${closed.payoutId} back in the book`
    )
    this.announce(closed)

    return closed
  }

  /**
   * Stops a top-up and waits for a person.
   *
   * Keeps the payout: the cases that reach here are the ones where money may
   * already have moved, and giving that payout to another trader is the mistake
   * this whole design exists to avoid.
   */
  async review(record: TmaFiatDepositRecord): Promise<TmaFiatDepositRecord | null> {
    const flagged = await this.fiatDepositDb.markForReview(record._id.toString())
    if (flagged === null) return null

    this.announce(flagged)

    return flagged
  }
}
