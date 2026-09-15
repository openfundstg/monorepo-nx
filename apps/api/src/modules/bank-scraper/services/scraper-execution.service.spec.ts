import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import { ERROR } from '@transacto/contracts'
import { ScraperExecutionService } from './scraper-execution.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { OrderDbService } from 'src/modules/repositories/order-db'
import type { BankScraperService } from './bank-scraper.service'
import type { TerminalStateCacheService } from './terminal-state-cache.service'
import type { BalanceProcessorService } from './balance-processor.service'
import type { TerminalErrorHandlerService } from './terminal-error-handler.service'
import type { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'
import type { ScraperJobData } from 'src/shared/constants'
import { BankProvider } from 'src/shared/constants'
import { BANK_DROP_CONFIRM_MS } from 'src/modules/bank-scraper/constants'
import type {
  TerminalActivationService,
  TerminalDeactivationService
} from 'src/modules/terminal'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TERMINAL_ID = 23892
const TRADER_ID = 346
const CARD_ID = 100

const jobData: ScraperJobData = {
  terminalId: TERMINAL_ID,
  targetId: 'abc123',
  targetUrl: 'https://next.privat24.ua/send/abc123',
  apiToken: 'token',
  traderId: TRADER_ID,
  cardId: CARD_ID,
  isManualSync: false,
}

describe('ScraperExecutionService', () => {
  let db: { findOne: jest.Mock; updateOne: jest.Mock }
  let scraper: { scrape: jest.Mock }
  let cache: {
    renewHeartbeat: jest.Mock
    acquireLock: jest.Mock
    releaseLock: jest.Mock
    getCurrentState: jest.Mock
    getBaseline: jest.Mock
    markDropSeen: jest.Mock
    clearDropSeen: jest.Mock
  }
  let errorHandler: { handleDeadJar: jest.Mock }
  let balanceProcessor: { processBalance: jest.Mock }
  let orchestrator: { broadcastBalanceUpdate: jest.Mock }
  let deactivation: { stopRouting: jest.Mock }
  let activation: { resumeRouting: jest.Mock }
  let sales: { isAwaitingJarClosureByCardId: jest.Mock }
  let scheduleNext: jest.Mock
  let stopPolling: jest.Mock
  let service: ScraperExecutionService

  beforeEach(() => {
    db = {
      findOne: jest.fn().mockResolvedValue({
        traderId: TRADER_ID,
        cardId: CARD_ID,
        terminalId: TERMINAL_ID,
        terminalName: 'T-1',
        cred3: jobData.targetUrl,
        enabled: true,
      }),
      updateOne: jest.fn().mockResolvedValue(undefined),
    }
    scraper = { scrape: jest.fn() }
    cache = {
      renewHeartbeat: jest.fn().mockResolvedValue(undefined),
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      getCurrentState: jest.fn().mockResolvedValue(null),
      getBaseline: jest.fn().mockResolvedValue(null),
      // How long the drop has persisted, and whether this reading opened it.
      // `isFirst` is what pauses routing, so it is part of every answer.
      markDropSeen: jest.fn().mockResolvedValue({ persistedMs: 0, isFirst: true }),
      // Whether a drop was actually in progress — which is how the caller knows
      // there is a paused terminal to put back in front of payers.
      clearDropSeen: jest.fn().mockResolvedValue(false),
    }
    errorHandler = { handleDeadJar: jest.fn().mockResolvedValue(undefined) }
    balanceProcessor = {
      processBalance: jest.fn().mockResolvedValue({ shouldRequeue: true }),
    }
    orchestrator = { broadcastBalanceUpdate: jest.fn().mockResolvedValue(undefined) }
    deactivation = { stopRouting: jest.fn().mockResolvedValue(undefined) }
    activation = { resumeRouting: jest.fn().mockResolvedValue(undefined) }
    // No finished sale behind this card by default: an ordinary trader terminal,
    // which is what every case here but one is about.
    sales = { isAwaitingJarClosureByCardId: jest.fn().mockResolvedValue(false) }
    scheduleNext = jest.fn()
    stopPolling = jest.fn()

    service = new ScraperExecutionService(
      db as unknown as TerminalDbService,
      {} as unknown as OrderDbService,
      scraper as unknown as BankScraperService,
      cache as unknown as TerminalStateCacheService,
      balanceProcessor as unknown as BalanceProcessorService,
      errorHandler as unknown as TerminalErrorHandlerService,
      {} as unknown as EventEmitter2,
      orchestrator as unknown as TerminalBalanceOrchestratorService,
      deactivation as unknown as TerminalDeactivationService,
      activation as unknown as TerminalActivationService,
      sales as unknown as TmaSaleDbService,
    )
  })

  describe('a jar that no longer exists', () => {
    /**
     * The bug in the logs. PrivatBank answering `active: false` and PUMB
     * answering a non-ACTIVE status both raise `ERROR.TERMINAL.INACTIVE`, which
     * is a 400 — so it used to fall past the 404 branch to the generic one at
     * the bottom, which reschedules. The terminal was re-scraped every few
     * seconds, forever, and the error was logged every time.
     */
    it('stands the terminal down when the bank reports the jar closed', async () => {
      scraper.scrape.mockRejectedValue(new BadRequestException(ERROR.TERMINAL.INACTIVE))

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(errorHandler.handleDeadJar).toHaveBeenCalledWith(
        TERMINAL_ID,
        TRADER_ID,
        CARD_ID,
        'token',
        expect.stringContaining('closed'),
      )
      expect(stopPolling).toHaveBeenCalledWith(TERMINAL_ID)
      // The whole point: no retry is queued.
      expect(scheduleNext).not.toHaveBeenCalled()
    })

    it('still stands it down on a 404 from the bank', async () => {
      scraper.scrape.mockRejectedValue(new NotFoundException(ERROR.TERMINAL.NOT_FOUND))

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(errorHandler.handleDeadJar).toHaveBeenCalledWith(
        TERMINAL_ID,
        TRADER_ID,
        CARD_ID,
        'token',
        'HTTP 404',
      )
      expect(stopPolling).toHaveBeenCalledWith(TERMINAL_ID)
      expect(scheduleNext).not.toHaveBeenCalled()
    })
  })

  describe('failures that are not a dead jar', () => {
    /**
     * These share the 400 with INACTIVE and must keep retrying — a malformed
     * balance is transient, and treating it as a dead jar would disable a
     * perfectly live terminal on one bad response.
     */
    it.each([
      ['a malformed balance', ERROR.SCRAPER.INVALID_BALANCE_FORMAT],
      ['an unparseable cred URL', ERROR.TERMINAL.INVALID_CRED_URL],
    ])('keeps retrying after %s', async (_label, errorConstant) => {
      scraper.scrape.mockRejectedValue(new BadRequestException(errorConstant))

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(errorHandler.handleDeadJar).not.toHaveBeenCalled()
      expect(scheduleNext).toHaveBeenCalled()
    })

    it('keeps retrying after a plain network error', async () => {
      scraper.scrape.mockRejectedValue(new Error('ECONNRESET'))

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(errorHandler.handleDeadJar).not.toHaveBeenCalled()
      expect(scheduleNext).toHaveBeenCalled()
    })
  })

  /**
   * Redis holds the live balance, but `current` expires after an hour and every
   * deactivation path deletes it. Without a durable copy a switched-off terminal
   * has no balance anywhere, which is why the extension could only show figures
   * for jars the scraper was actively polling.
   */
  describe('the durable copy of the balance', () => {
    it('writes the scraped figures when the balance moves', async () => {
      cache.getCurrentState.mockResolvedValue({ current: 100_000, goal: 235_000 })
      scraper.scrape.mockResolvedValue({ actualBalance: 120_000, goal: 235_000 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(db.updateOne).toHaveBeenCalledWith(
        { traderId: TRADER_ID, cardId: CARD_ID },
        {
          $set: {
            lastBalance: 120_000,
            lastBalanceAt: expect.any(Date),
            lastGoal: 235_000,
          },
        },
      )
    })

    it('writes when only the goal moves', async () => {
      cache.getCurrentState.mockResolvedValue({ current: 100_000, goal: 235_000 })
      scraper.scrape.mockResolvedValue({ actualBalance: 100_000, goal: 300_000 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(db.updateOne).toHaveBeenCalledWith(
        { traderId: TRADER_ID, cardId: CARD_ID },
        { $set: expect.objectContaining({ lastGoal: 300_000 }) },
      )
    })

    /**
     * The scraper comes back every 5–10s per terminal whether or not anything
     * changed. An unconditional write here would be one Mongo update per
     * terminal per pass, forever, to store a number that has not moved.
     */
    it('writes nothing when neither figure moved', async () => {
      cache.getCurrentState.mockResolvedValue({ current: 100_000, goal: 235_000 })
      scraper.scrape.mockResolvedValue({ actualBalance: 100_000, goal: 235_000 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(db.updateOne).not.toHaveBeenCalled()
    })

    /**
     * A scrape that omits the target says nothing about it. Writing `null`
     * would throw away the only copy we have.
     */
    it('leaves the stored goal alone when the bank reports none', async () => {
      cache.getCurrentState.mockResolvedValue({ current: 100_000, goal: 235_000 })
      scraper.scrape.mockResolvedValue({ actualBalance: 120_000, goal: null })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      const [, update] = db.updateOne.mock.calls[0]
      expect(update.$set).not.toHaveProperty('lastGoal')
      expect(update.$set.lastBalance).toBe(120_000)
    })

    it('writes on the first scrape, when nothing is cached yet', async () => {
      cache.getCurrentState.mockResolvedValue(null)
      scraper.scrape.mockResolvedValue({ actualBalance: 120_000, goal: 235_000 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(db.updateOne).toHaveBeenCalled()
    })
  })

  /**
   * A balance below the baseline disables the credential on Transacto, fails
   * every pending order on the card and stops the loop — irreversibly, from
   * here. NovaPay's balance is parsed out of a page with no contract behind it,
   * and a misread grouped figure once reported ₴1 for a jar nobody had touched.
   */
  describe('a balance that went down', () => {
    beforeEach(() => {
      cache.getCurrentState.mockResolvedValue({ current: 191_700, goal: 664_200 })
      cache.getBaseline.mockResolvedValue(191_700)
    })

    it('asks the bank again before acting on it', async () => {
      scraper.scrape
        .mockResolvedValueOnce({ actualBalance: 100, goal: 664_200 })
        .mockResolvedValueOnce({ actualBalance: 191_700, goal: 664_200 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(scraper.scrape).toHaveBeenCalledTimes(2)
      // Nothing acted on: no processing, no broadcast, no durable write.
      expect(balanceProcessor.processBalance).not.toHaveBeenCalled()
      expect(orchestrator.broadcastBalanceUpdate).not.toHaveBeenCalled()
      expect(db.updateOne).not.toHaveBeenCalled()
      // …and the loop keeps going, so the next scrape decides.
      expect(scheduleNext).toHaveBeenCalled()
      expect(stopPolling).not.toHaveBeenCalled()
    })

    /** A withdrawal both readings agree on is a withdrawal. */
    it('acts on the second reading when it agrees', async () => {
      scraper.scrape
        .mockResolvedValueOnce({ actualBalance: 90_000, goal: 664_200 })
        .mockResolvedValueOnce({ actualBalance: 80_000, goal: 664_200 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(balanceProcessor.processBalance).toHaveBeenCalledWith(
        jobData,
        'T-1',
        expect.anything(),
        80_000,
        664_200,
        expect.anything(),
        expect.anything(),
      )
    })

    /** The common case pays nothing for this: a jar that is filling up is read once. */
    it('does not re-read a balance that went up', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 300_000, goal: 664_200 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(scraper.scrape).toHaveBeenCalledTimes(1)
      expect(balanceProcessor.processBalance).toHaveBeenCalled()
    })

    /** No baseline yet is the first scrape of a terminal — there is nothing to fall from. */
    it('does not re-read when there is no baseline', async () => {
      cache.getBaseline.mockResolvedValue(null)
      scraper.scrape.mockResolvedValue({ actualBalance: 100, goal: 664_200 })

      await service.executeScrape(jobData, scheduleNext, stopPolling)

      expect(scraper.scrape).toHaveBeenCalledTimes(1)
      expect(balanceProcessor.processBalance).toHaveBeenCalled()
    })
  })

  /**
   * NovaPay intermittently answers with a balance from about a minute earlier —
   * a stale render served from a cache on their side. Nothing about the
   * response says so: the figure is not corrupt, and it is not even wrong. It
   * is what the jar held a minute ago.
   *
   * Asking again does not help, because the second request lands in the same
   * cache. The only thing separating a stale read from a withdrawal is time, so
   * a NovaPay drop has to keep reading that way for thirty seconds first.
   */
  describe('a NovaPay balance that dips and comes back', () => {
    const novaPayJob: ScraperJobData = {
      ...jobData,
      targetUrl: 'https://e-com.novapay.ua/case/3g0nPEoQJ9',
    }

    beforeEach(() => {
      db.findOne.mockResolvedValue({
        traderId: TRADER_ID,
        cardId: CARD_ID,
        terminalId: TERMINAL_ID,
        terminalName: 'T-1',
        cred3: novaPayJob.targetUrl,
        enabled: true,
      })
      cache.getCurrentState.mockResolvedValue({ current: 251_200, goal: 664_200 })
      cache.getBaseline.mockResolvedValue(251_200)
      scraper.scrape.mockResolvedValue({ actualBalance: 152_600, goal: 664_200 })
    })

    it('does nothing at all with a drop it has only just seen', async () => {
      cache.markDropSeen.mockResolvedValue({ persistedMs: 0, isFirst: false })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(balanceProcessor.processBalance).not.toHaveBeenCalled()
      // Not even a re-read: the second request lands in the same stale cache,
      // so spending it buys nothing.
      expect(scraper.scrape).toHaveBeenCalledTimes(1)
      expect(scheduleNext).toHaveBeenCalled()
    })

    /**
     * And nothing is recorded either, which is what makes the recovery clean.
     * The cached balance never moved, so the true figure coming back reads as
     * the balance it always was rather than as a fresh deposit nobody ordered.
     */
    it('broadcasts and persists nothing while it waits', async () => {
      cache.markDropSeen.mockResolvedValue({ persistedMs: 20_000, isFirst: false })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(orchestrator.broadcastBalanceUpdate).not.toHaveBeenCalled()
      expect(db.updateOne).not.toHaveBeenCalled()
    })

    it('believes it once the window has elapsed', async () => {
      // Read from the constant, not written down: the window was raised from
      // thirty seconds to three minutes because thirty was measured and found
      // short, and a literal here would have kept testing the old rule.
      cache.markDropSeen.mockResolvedValue({
        persistedMs: BANK_DROP_CONFIRM_MS[BankProvider.NOVAPAY],
        isFirst: false
      })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(balanceProcessor.processBalance).toHaveBeenCalledWith(
        novaPayJob,
        'T-1',
        expect.anything(),
        152_600,
        664_200,
        expect.anything(),
        expect.anything(),
      )
    })

    /**
     * **Routing stops the moment the drop is seen, not when it is believed.**
     *
     * This is what makes a three-minute window affordable. On 2026-09-06 the
     * old thirty-second one elapsed against a stale reading and tore a live
     * terminal down; lengthening it alone would have meant three more minutes
     * of payers routed to a jar that might genuinely be emptying. Now the
     * routing stops at once and only the verdict waits.
     */
    it('holds new orders back from the first bad reading', async () => {
      cache.markDropSeen.mockResolvedValue({ persistedMs: 0, isFirst: true })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(deactivation.stopRouting).toHaveBeenCalledWith(
        expect.objectContaining({ terminalId: TERMINAL_ID, cardId: CARD_ID, apiToken: 'token' }),
      )
      // Held back, not torn down: no alert, no cancellation, still scraped.
      expect(balanceProcessor.processBalance).not.toHaveBeenCalled()
      expect(stopPolling).not.toHaveBeenCalled()
    })

    /** One call, on the way in. Redis decides which reading that is. */
    it('does not call upstream again on every poll inside the drop', async () => {
      cache.markDropSeen.mockResolvedValue({ persistedMs: 60_000, isFirst: false })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(deactivation.stopRouting).not.toHaveBeenCalled()
    })

    /** And the balance coming back puts it in front of payers again. */
    it('resumes routing when the drop turns out to be noise', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 251_200, goal: 664_200 })
      cache.clearDropSeen.mockResolvedValue(true)

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(activation.resumeRouting).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: CARD_ID, apiToken: 'token' }),
      )
    })

    /**
     * …unless the sale behind the jar is already over.
     *
     * That terminal switched its own routing off at the ending, on purpose, and
     * this is the one path that could switch it back on. Reviving it would send
     * payers to a jar with nothing left to pay for, and their hryvnia would land
     * where nothing is matching it any more.
     */
    it('leaves a finished jar out of the routing however healthy it reads', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 251_200, goal: 664_200 })
      cache.clearDropSeen.mockResolvedValue(true)
      sales.isAwaitingJarClosureByCardId.mockResolvedValue(true)

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(activation.resumeRouting).not.toHaveBeenCalled()
    })

    /** Fails towards leaving it paused: an unread answer is not a green light. */
    it('leaves it paused when the sale cannot be read', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 251_200, goal: 664_200 })
      cache.clearDropSeen.mockResolvedValue(true)
      sales.isAwaitingJarClosureByCardId.mockRejectedValue(new Error('mongo is down'))

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(activation.resumeRouting).not.toHaveBeenCalled()
    })

    /**
     * A terminal nobody paused is never "resumed" — that would hand
     * `enable_orders: 1` to a credential somebody switched off on purpose.
     */
    it('resumes nothing when no drop was in progress', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 251_200, goal: 664_200 })
      cache.clearDropSeen.mockResolvedValue(false)

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(activation.resumeRouting).not.toHaveBeenCalled()
    })

    /** Neither call may break the scrape: the drop is still being measured. */
    it('keeps scraping when the pause cannot be arranged upstream', async () => {
      cache.markDropSeen.mockResolvedValue({ persistedMs: 0, isFirst: true })
      deactivation.stopRouting.mockRejectedValue(new Error('Transacto is down'))

      await expect(
        service.executeScrape(novaPayJob, scheduleNext, stopPolling),
      ).resolves.toBeUndefined()
      expect(scheduleNext).toHaveBeenCalled()
    })

    /**
     * The marker measures one drop. Left behind, it would hand the next
     * unrelated dip a clock that started hours ago — which fires instantly, and
     * is exactly the outcome this exists to prevent.
     */
    it('forgets the drop as soon as the balance is back', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 251_200, goal: 664_200 })

      await service.executeScrape(novaPayJob, scheduleNext, stopPolling)

      expect(cache.clearDropSeen).toHaveBeenCalledWith(TERMINAL_ID)
      expect(balanceProcessor.processBalance).toHaveBeenCalled()
    })
  })

  /**
   * The wait is NovaPay's, not the pipeline's. Every other bank answers from
   * its own ledger, and delaying a real withdrawal by thirty seconds would
   * delay the one alert that matters for nothing.
   */
  it('makes a PrivatBank drop wait for nothing', async () => {
    cache.getCurrentState.mockResolvedValue({ current: 251_200 })
    cache.getBaseline.mockResolvedValue(251_200)
    scraper.scrape.mockResolvedValue({ actualBalance: 152_600 })

    await service.executeScrape(jobData, scheduleNext, stopPolling)

    expect(cache.markDropSeen).not.toHaveBeenCalled()
    // Straight to the two-reading check, and through it.
    expect(scraper.scrape).toHaveBeenCalledTimes(2)
    expect(balanceProcessor.processBalance).toHaveBeenCalled()
  })

  it('always releases the lock, however the scrape ended', async () => {
    scraper.scrape.mockRejectedValue(new BadRequestException(ERROR.TERMINAL.INACTIVE))

    await service.executeScrape(jobData, scheduleNext, stopPolling)

    expect(cache.releaseLock).toHaveBeenCalledWith(TERMINAL_ID)
  })
})
