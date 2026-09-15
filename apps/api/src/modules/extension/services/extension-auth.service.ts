import { ERROR } from '@transacto/contracts'
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import { ensure } from 'src/shared/utils'

@Injectable()
export class ExtensionAuthService {
  private readonly logger = new Logger(ExtensionAuthService.name)

  constructor(
    private readonly transactoApiService: TransactoApiService,
    private readonly traderDbService: TraderDbService,
    @InjectQueue(BANK_SCRAPER_QUEUE_NAME) private readonly monoQueue: Queue
  ) {}

  async authenticate(apiToken: string): Promise<{ traderId: string }> {
    ensure(apiToken, new UnauthorizedException(ERROR.AUTH.MISSING_API_TOKEN_HEADER))

    let trader = await this.traderDbService.findByApiToken(apiToken)

    if (!trader) {
      try {
        const profile = await this.transactoApiService.getTraderProfile(apiToken)
        if (typeof profile?.id !== 'number') {
          throw new UnauthorizedException(ERROR.AUTH.INVALID_TRANSACTO_PROFILE)
        }

        const traderId = profile.id
        trader = await this.traderDbService.upsert(traderId, apiToken)
        this.logger.log(`New trader ${traderId} registered via Extension Auth.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Failed to authenticate token with Transacto: ${message}`)
        throw new UnauthorizedException(ERROR.AUTH.INVALID_API_TOKEN)
      }
    } else if (!trader.isActive) {
      await this.traderDbService.activateTrader(trader.traderId)
      this.logger.log(`Trader ${trader.traderId} re-activated via Extension Auth.`)
    }

    return { traderId: trader.traderId.toString() }
  }

  async deactivateTrader(traderId: number): Promise<{ success: boolean; removedJobs: number }> {
    await this.traderDbService.deactivateTrader(traderId)
    this.logger.log(`Trader ${traderId} deactivated. Initiating kill switch.`)

    const jobs = await this.monoQueue.getJobs(['delayed', 'waiting', 'active'])
    let removedCount = 0

    for (const job of jobs) {
      if (job.data && job.data.traderId === traderId) {
        try {
          await job.remove()
          removedCount++
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger.error(`Failed to remove job ${job.id}: ${message}`)
        }
      }
    }

    this.logger.log(`Kill Switch: Removed ${removedCount} jobs for trader ${traderId}.`)
    return { success: true, removedJobs: removedCount }
  }
}
