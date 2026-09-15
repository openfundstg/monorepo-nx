import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { TMA_DEPOSIT_EXPIRY_QUEUE } from 'src/shared/constants'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { TmaDepositStatus } from 'src/modules/repositories/tma-deposit-db/schemas'

@Processor(TMA_DEPOSIT_EXPIRY_QUEUE)
export class DepositExpiryWorker extends WorkerHost {
  private readonly logger = new Logger(DepositExpiryWorker.name)

  constructor(
    private readonly depositDbService: TmaDepositDbService,
    private readonly tmaGateway: TmaGateway
  ) {
    super()
  }

  /**
   * Runs every 60 seconds via repeatable job scheduler.
   * Expires stale PENDING deposits and emits WebSocket notifications.
   */
  async process(_job: Job): Promise<void> {
    try {
      const expiredDeposits = await this.depositDbService.expireStaleDeposits()

      if (expiredDeposits.length === 0) return

      // Emit WS events for each expired deposit
      for (const { id, telegramId } of expiredDeposits) {
        this.tmaGateway.emitDepositStatusChange(telegramId, id, TmaDepositStatus.EXPIRED)
      }

      this.logger.log(`Processed ${expiredDeposits.length} expired deposits`)
    } catch (error) {
      this.logger.error(`Deposit expiry worker failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
