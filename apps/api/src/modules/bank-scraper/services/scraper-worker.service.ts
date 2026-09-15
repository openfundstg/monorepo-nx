import { ERROR } from '@transacto/contracts'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { BadRequestException, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common'
import { Job } from 'bullmq'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import type { ScraperJobData } from 'src/shared/constants'
import environments from 'src/environments'
import { ensure, extractTargetId, describeError } from 'src/shared/utils'
import { ScraperExecutionService } from './scraper-execution.service'
import { TerminalStateCacheService } from './terminal-state-cache.service'

const POLL_INTERVAL_MS = Number(environments.MONO_POLL_INTERVAL_MS) || 5000

@Processor(BANK_SCRAPER_QUEUE_NAME, { concurrency: 15 })
export class BankScraperWorkerService extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(BankScraperWorkerService.name)
  private activeLoops = new Map<number, NodeJS.Timeout | true>()

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly executionService: ScraperExecutionService,
    private readonly terminalStateCache: TerminalStateCacheService
  ) {
    super()
  }

  /**
   * Hands back every loop lease this process is holding, on the way out.
   *
   * The loops themselves are `setTimeout`s in this map and die with the process
   * — but their leases live in Redis with 35 seconds on the clock, and the
   * watchdog reads a live lease as a healthy loop. So a restarted API used to
   * come up, ask which loops were dead, and be told by its predecessor's leases
   * that none of them were: the first watchdog pass revived nothing and the
   * scraper only started at the *second*, a minute later. Measured at 74s in
   * production, which is the whole of the "the scraper takes a minute or two
   * after a restart" complaint.
   *
   * Only this process's own leases, and only the terminals it was actually
   * looping — a second instance's claims stay true and are left alone.
   *
   * A kill that skips this (`SIGKILL`, an OOM) leaves the leases to expire as
   * before, and the watchdog's next pass picks the loops up. Slower, but no
   * worse than it was.
   */
  async onApplicationShutdown(): Promise<void> {
    const terminalIds = [...this.activeLoops.keys()]
    if (!terminalIds.length) return

    for (const terminalId of terminalIds) this.stopPolling(terminalId)

    try {
      await Promise.all(
        terminalIds.map((terminalId) => this.terminalStateCache.releaseHeartbeat(terminalId))
      )

      this.logger.log(
        `Shutting down: released the polling lease on ${terminalIds.length} terminal(s), so the ` +
          `next process revives them at once rather than waiting for them to expire.`
      )
    } catch (error: unknown) {
      // Redis may already be going down with the rest of the app. The leases
      // then expire on their own, which is exactly the old behaviour.
      this.logger.warn(`Shutting down: could not release polling leases: ${describeError(error)}`)
    }
  }

  /**
   * Scrapes one terminal immediately, on the trader's request.
   *
   * Looks the terminal up by id. It used to take the bank's `targetId` and
   * match it with `cred3.includes(...)`, while the controller handed it the
   * route's `:terminalId` — so the lookup only succeeded when the terminal id
   * happened to appear inside the jar URL, and the sync button otherwise
   * answered 404.
   *
   * The `traderId` filter is deliberate: it keeps a trader from syncing someone
   * else's terminal even if the guard above ever changes.
   */
  async forceSyncTerminal(terminalId: number, traderId: number, apiToken: string): Promise<void> {
    const terminal = ensure(
      await this.terminalDbService.findOne({ traderId, terminalId }),
      new NotFoundException(ERROR.TERMINAL.NOT_FOUND)
    )

    const targetId = ensure(
      terminal.cred3 ? extractTargetId(terminal.cred3) : null,
      new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)
    )

    const jobData: ScraperJobData = {
      terminalId: terminal.terminalId,
      targetId,
      targetUrl: terminal.cred3 as string,
      apiToken, // Passed from controller
      traderId,
      cardId: terminal.cardId,
      isManualSync: true
    }

    await this.process({ data: jobData } as Job<ScraperJobData>)
  }

  async process(job: Job<ScraperJobData>): Promise<void> {
    const data = job.data

    if (data.isManualSync) {
      await this.executionService.executeScrape(
        data,
        this.scheduleNext.bind(this),
        this.stopPolling.bind(this)
      )
      return
    }

    if (this.activeLoops.has(data.terminalId)) return // Loop is already running, do not spawn a duplicate

    this.activeLoops.set(data.terminalId, true)
    await this.executionService.executeScrape(
      data,
      this.scheduleNext.bind(this),
      this.stopPolling.bind(this)
    )
  }

  private stopPolling(terminalId: number) {
    const timeout = this.activeLoops.get(terminalId)
    if (timeout && typeof timeout !== 'boolean') {
      clearTimeout(timeout)
    }
    this.activeLoops.delete(terminalId)
  }

  private scheduleNext(terminalId: number, data: ScraperJobData, customDelay?: number): void {
    if (!this.activeLoops.has(terminalId)) return

    let delay = customDelay
    if (delay === undefined) {
      delay = Math.floor(Math.random() * (POLL_INTERVAL_MS / 2)) + POLL_INTERVAL_MS
    }

    const timeout = setTimeout(async () => {
      if (!this.activeLoops.has(terminalId)) return
      await this.executionService.executeScrape(
        data,
        this.scheduleNext.bind(this),
        this.stopPolling.bind(this)
      )
    }, delay)

    this.activeLoops.set(terminalId, timeout)
  }
}
