import { ScraperWatchdogService } from './scraper-watchdog.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TraderDbService } from 'src/modules/repositories/trader-db/services'

const JAR_URL = 'https://send.monobank.ua/jar/3gZ5yd9d5LTPbVAXpbsABdPx51QzZc5i'

const terminal = (terminalId: number, traderId: number) => ({
  terminalId,
  traderId,
  cardId: terminalId + 500,
  cred3: JAR_URL,
  enabled: true,
})

describe('ScraperWatchdogService', () => {
  let terminalDb: { find: jest.Mock }
  let traderDb: { findAllActive: jest.Mock }
  let queue: { add: jest.Mock }
  let redis: { get: jest.Mock; set: jest.Mock }
  let watchdog: ScraperWatchdogService

  beforeEach(() => {
    terminalDb = { find: jest.fn() }
    traderDb = { findAllActive: jest.fn().mockResolvedValue([{ traderId: 346, apiToken: 'tok' }]) }
    queue = { add: jest.fn().mockResolvedValue(undefined) }
    // Every loop looks dead, so each terminal is a revive candidate
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }

    watchdog = new ScraperWatchdogService(
      terminalDb as unknown as TerminalDbService,
      traderDb as unknown as TraderDbService,
      queue as never,
      redis as never,
    )
  })

  const revivedTerminalIds = () =>
    queue.add.mock.calls.map(([, jobData]) => (jobData as { terminalId: number }).terminalId)

  it('revives every dead loop belonging to an active trader', async () => {
    terminalDb.find.mockResolvedValue([terminal(23715, 346), terminal(23893, 346)])

    await watchdog.watchScraperLoops()

    expect(revivedTerminalIds()).toEqual([23715, 23893])
  })

  /**
   * Nothing else starts a polling loop, so until this runs the scraper is not
   * running at all. Waiting for the next whole minute meant a deploy cost up to
   * a minute of no scraping — and, while the previous process's leases were
   * still warm, up to two.
   */
  it('runs a pass as soon as the process is up', async () => {
    terminalDb.find.mockResolvedValue([terminal(23715, 346)])

    await watchdog.onApplicationBootstrap()

    expect(revivedTerminalIds()).toEqual([23715])
  })

  /**
   * The load-bearing case for a sale the user has stopped while
   * payments were still outstanding.
   *
   * Such a terminal is told `enable_orders: 0` upstream and carries
   * `acceptingOrders: false` here, but stays `enabled` — and it has to stay in
   * this sweep. An outstanding order is only ever confirmed by the matcher
   * noticing the money land, and the matcher only runs off a scrape; nobody
   * checks a jar by hand. Drop it from here and that order never becomes
   * EXECUTED, while the jar quietly takes the payer's hryvnia.
   */
  it('keeps reviving a terminal that has stopped taking new orders', async () => {
    terminalDb.find.mockResolvedValue([
      { ...terminal(23715, 346), acceptingOrders: false },
    ])

    await watchdog.watchScraperLoops()

    expect(revivedTerminalIds()).toEqual([23715])
  })

  /** The query is what decides, and it asks about `enabled` and nothing else. */
  it('asks only for enabled terminals, never about order routing', async () => {
    terminalDb.find.mockResolvedValue([])

    await watchdog.watchScraperLoops()

    expect(terminalDb.find).toHaveBeenCalledWith({ enabled: true })
  })

  it('keeps going when a terminal has no active trader', async () => {
    // The Mini App stores its own copy under traderId 0, which has no API token.
    // That used to throw inside the loop while the catch sat outside it, so one
    // orphan aborted the whole pass and every terminal after it stayed dead.
    terminalDb.find.mockResolvedValue([
      terminal(25144, 0),
      terminal(23715, 346),
      terminal(23893, 346),
    ])

    await watchdog.watchScraperLoops()

    expect(revivedTerminalIds()).toEqual([23715, 23893])
  })

  it('does not claim the heartbeat for a terminal it cannot scrape', async () => {
    // Marking the loop alive would suppress the next watchdog pass for nothing
    terminalDb.find.mockResolvedValue([terminal(25144, 0)])

    await watchdog.watchScraperLoops()

    expect(redis.set).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('leaves a live loop alone', async () => {
    redis.get.mockResolvedValue('1')
    terminalDb.find.mockResolvedValue([terminal(23715, 346)])

    await watchdog.watchScraperLoops()

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('skips terminals whose URL belongs to no supported bank', async () => {
    terminalDb.find.mockResolvedValue([
      { ...terminal(23715, 346), cred3: 'https://example.com/whatever' },
    ])

    await watchdog.watchScraperLoops()

    expect(queue.add).not.toHaveBeenCalled()
  })
})
