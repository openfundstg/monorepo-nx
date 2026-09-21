import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import environments from 'src/environments'
import { DAY_MS } from 'src/shared/constants'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { FiatReceiptStorageService } from 'src/modules/telegram-mini-app/services/fiat-receipt-storage.service'
import { describeError } from 'src/shared/utils'

/**
 * How long a receipt's bytes are kept, in days, when nothing says otherwise.
 *
 * Sixty, and shorter than a statement's ninety on purpose. A receipt proves one
 * transfer and the dispute it answers is settled in days; a statement is
 * somebody's whole history and the appeal it answers can run for months. The
 * two retentions are separate numbers because they are answers to separate
 * questions, not because anybody wanted two variables.
 */
const DEFAULT_RETENTION_DAYS = 60

/** How many files one pass will remove, so a first sweep of a long backlog is bounded. */
const BATCH = 500

/**
 * Deleting archived receipts once nothing needs them.
 *
 * The receipt half of the rule `SaleStatementRetentionService` states in full,
 * and it follows that service exactly — **the file goes, the record stays**,
 * and the file is removed *before* the row is marked, so a failure leaves a
 * document that will be tried again rather than one nothing points at and
 * nothing will ever remove.
 *
 * What stays on the row is what the receipt was judged to say: the verdict, the
 * sum Transacto recognised, the bank that vouched for it, and whether the
 * recipient was comparable at all. That is the audit trail. What goes is a
 * document stating a payer's and a recipient's credentials in full.
 */
@Injectable()
export class FiatReceiptRetentionService {
  private readonly logger = new Logger(FiatReceiptRetentionService.name)

  /** One pass at a time: a sweep that overlaps itself deletes twice. */
  private running = false

  constructor(
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly storage: FiatReceiptStorageService
  ) {}

  /** Daily, at a quiet hour and an hour after the statements sweep. */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async purgeExpiredReceipts(): Promise<void> {
    if (this.running) {
      this.logger.debug('Receipt retention sweep already in progress, skipping')
      return
    }

    this.running = true
    try {
      const cutoff = new Date(Date.now() - this.retentionDays() * DAY_MS)
      const expired = await this.fiatDepositDb.findReceiptsToPurge(cutoff, BATCH)
      if (expired.length === 0) return

      let purged = 0

      for (const receipt of expired) {
        // One failure must not strand every other document behind it.
        try {
          await this.storage.remove(receipt.storedName)
          await this.fiatDepositDb.markReceiptPurged(
            receipt.depositId,
            receipt.receiptId,
            new Date()
          )
          purged += 1
        } catch (error: unknown) {
          this.logger.error(
            `Could not purge receipt ${receipt.receiptId.toString()}: ${describeError(error)}`
          )
        }
      }

      // Counts only. Whose receipt it was and what was on it are things this
      // sweep deliberately says nothing about.
      if (purged > 0) this.logger.log(`Retention: deleted ${purged} receipt file(s)`)
    } catch (error: unknown) {
      this.logger.error(`Receipt retention sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /** Read per pass, so a deployment can shorten it without a restart. */
  private retentionDays(): number {
    const configured = Number(environments.FIAT_RECEIPT_RETENTION_DAYS)

    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
  }
}
