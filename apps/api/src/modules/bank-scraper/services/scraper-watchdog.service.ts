import { Injectable, Logger, Inject, OnApplicationBootstrap } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import type { ScraperJobData } from 'src/shared/constants'
import { getBankProvider, extractTargetId } from 'src/shared/utils'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'

@Injectable()
export class ScraperWatchdogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScraperWatchdogService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly traderDbService: TraderDbService,
    @InjectQueue(BANK_SCRAPER_QUEUE_NAME) private readonly monoQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * Runs a pass the moment the process is up, instead of waiting for the cron.
   *
   * Every polling loop is a `setTimeout` inside `BankScraperWorkerService`, so a
   * restart ends all of them and this watchdog is the only thing that starts
   * them again. Waiting for the next whole minute meant the scraper simply did
   * not run for up to a minute after every deploy — and, while the previous
   * process's leases were still warm, for up to two.
   *
   * Safe to run here precisely because it is the same pass the cron runs: it
   * revives a terminal only when nothing holds its lease, and it takes the lease
   * before enqueuing. Nothing about it assumes it is the first.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Starting up: looking for scraper loops to start.')
    await this.watchScraperLoops()
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async watchScraperLoops(): Promise<void> {
    this.logger.debug('Running Scraper Watchdog...')
    try {
      const terminals = await this.terminalDbService.find({ enabled: true })
      const activeBankTerminals = terminals.filter((terminal) =>
        getBankProvider(terminal.cred3) !== null
      )
      const traders = await this.traderDbService.findAllActive()

      for (const terminal of activeBankTerminals) {
        if (!terminal.cred3) continue

        const targetId = extractTargetId(terminal.cred3)
        if (!targetId) continue

        const terminalId = terminal.terminalId
        const isAlive = await this.redis.get(RedisKeys.Terminal.loopActive(terminalId))

        if (!isAlive) {
          // Terminals whose trader is inactive — or that belong to no trader at
          // all, like the ones the Mini App creates under traderId 0 — have no
          // API token to scrape with. Skip them.
          //
          // This used to `ensure(...)` and throw, and the try/catch sits outside
          // the loop, so a single orphan terminal aborted the entire watchdog
          // pass and every terminal after it stayed dead.
          const trader = traders.find((trader) => trader.traderId === terminal.traderId)
          if (!trader?.apiToken) {
            this.logger.debug(
              `Watchdog: skipping terminal ${terminalId} — no active trader ${terminal.traderId}`
            )
            continue
          }

          this.logger.warn(
            `Watchdog: restarting dead polling loop for terminal ${terminalId} (targetId: ${targetId})`
          )
          // Immediately set the heartbeat so concurrent/subsequent calls don't duplicate
          await this.redis.set(RedisKeys.Terminal.loopActive(terminalId), '1', 'EX', 10)

          this.logger.log(`Watchdog revived dead/idle scraper loop for terminal ${terminalId}`)

          const apiToken = trader.apiToken

          const jobData: ScraperJobData = {
            terminalId,
            targetId,
            targetUrl: terminal.cred3,
            apiToken,
            traderId: terminal.traderId,
            cardId: terminal.cardId,
            isManualSync: false
          }

          await this.monoQueue.add(`terminal-${terminalId}`, jobData, {
            jobId: `terminal-${terminalId}-watchdog-${Date.now()}`,
            removeOnComplete: true,
            removeOnFail: 100
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      this.logger.error(`Scraper Watchdog failed: ${message}`, stack)
    }
  }
}
