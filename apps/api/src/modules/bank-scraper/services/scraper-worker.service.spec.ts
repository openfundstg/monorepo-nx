import { BadRequestException, NotFoundException } from '@nestjs/common'
import { BankScraperWorkerService } from './scraper-worker.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { ScraperExecutionService } from './scraper-execution.service'
import type { TerminalStateCacheService } from './terminal-state-cache.service'

const TRADER_ID = 346
const API_TOKEN = 'token'

describe('BankScraperWorkerService.forceSyncTerminal', () => {
  let terminalDb: { findOne: jest.Mock }
  let execution: { executeScrape: jest.Mock }
  let worker: BankScraperWorkerService

  beforeEach(() => {
    terminalDb = { findOne: jest.fn() }
    execution = { executeScrape: jest.fn().mockResolvedValue(undefined) }

    worker = new BankScraperWorkerService(
      terminalDb as unknown as TerminalDbService,
      execution as unknown as ScraperExecutionService,
      { releaseHeartbeat: jest.fn().mockResolvedValue(undefined) } as unknown as TerminalStateCacheService,
    )
  })

  const sync = (terminalId: number) => worker.forceSyncTerminal(terminalId, TRADER_ID, API_TOKEN)

  it('looks the terminal up by id, not by matching the id against the jar URL', async () => {
    // The bug: the lookup was `cred3.includes(terminalId)`, so the sync button
    // 404'd unless the terminal id happened to appear inside the URL.
    terminalDb.findOne.mockResolvedValue({
      terminalId: 25144,
      cardId: 25628,
      cred3: 'https://send.monobank.ua/jar/3gZ5yd9d5LTPbVAXpbsABdPx51QzZc5i',
    })

    await sync(25144)

    expect(terminalDb.findOne).toHaveBeenCalledWith({ traderId: TRADER_ID, terminalId: 25144 })
    expect(execution.executeScrape).toHaveBeenCalled()
  })

  it('passes the target extracted from the URL, not the terminal id', async () => {
    terminalDb.findOne.mockResolvedValue({
      terminalId: 25144,
      cardId: 25628,
      cred3: 'https://send.monobank.ua/jar/3gZ5yd9d5LTPbVAXpbsABdPx51QzZc5i',
    })

    await sync(25144)

    const [jobData] = execution.executeScrape.mock.calls[0]
    expect(jobData).toMatchObject({
      terminalId: 25144,
      cardId: 25628,
      targetId: '3gZ5yd9d5LTPbVAXpbsABdPx51QzZc5i',
      isManualSync: true,
    })
  })

  it('scopes the lookup to the caller, so one trader cannot sync another', async () => {
    terminalDb.findOne.mockResolvedValue(null)

    await expect(sync(25144)).rejects.toBeInstanceOf(NotFoundException)
    expect(terminalDb.findOne).toHaveBeenCalledWith({ traderId: TRADER_ID, terminalId: 25144 })
  })

  it('rejects a terminal with no usable bank URL', async () => {
    terminalDb.findOne.mockResolvedValue({ terminalId: 25144, cardId: 25628, cred3: null })

    await expect(sync(25144)).rejects.toBeInstanceOf(BadRequestException)
    expect(execution.executeScrape).not.toHaveBeenCalled()
  })
})

/**
 * Every polling loop is a `setTimeout` in this process, and its Redis lease
 * outlives the process by up to 35 seconds. The watchdog — the only thing that
 * ever starts a loop — reads a live lease as a healthy loop, so a restarted API
 * used to be told by its own predecessor that nothing needed reviving: the boot
 * pass found nothing, and the scraper started at the *next* minute's cron.
 * Measured at 74 seconds in production.
 */
describe('BankScraperWorkerService — handing back its loops on the way out', () => {
  let cache: { releaseHeartbeat: jest.Mock }
  let execution: { executeScrape: jest.Mock }
  let worker: BankScraperWorkerService

  beforeEach(() => {
    cache = { releaseHeartbeat: jest.fn().mockResolvedValue(undefined) }
    execution = { executeScrape: jest.fn().mockResolvedValue(undefined) }

    worker = new BankScraperWorkerService(
      { findOne: jest.fn() } as unknown as TerminalDbService,
      execution as unknown as ScraperExecutionService,
      cache as unknown as TerminalStateCacheService,
    )
  })

  /** `process` is what registers a terminal as looping in this worker. */
  const startLoop = (terminalId: number) =>
    worker.process({
      data: { terminalId, targetId: 'abc', targetUrl: 'u', apiToken: 't', traderId: 1, cardId: 2 },
    } as never)

  it('releases the lease on every terminal it was looping', async () => {
    await startLoop(23715)
    await startLoop(23893)

    await worker.onApplicationShutdown()

    expect(cache.releaseHeartbeat.mock.calls.map(([id]) => id)).toEqual([23715, 23893])
  })

  /** Another instance's leases are still true, so a process holding none says nothing. */
  it('releases nothing when it was running no loops', async () => {
    await worker.onApplicationShutdown()

    expect(cache.releaseHeartbeat).not.toHaveBeenCalled()
  })

  /**
   * Redis may already be going down with the rest of the app. The leases then
   * expire on their own, which is exactly the behaviour this replaces — a
   * shutdown must not fail over it.
   */
  it('gives up quietly when Redis is already gone', async () => {
    await startLoop(23715)
    cache.releaseHeartbeat.mockRejectedValue(new Error('connection closed'))

    await expect(worker.onApplicationShutdown()).resolves.toBeUndefined()
  })
})
