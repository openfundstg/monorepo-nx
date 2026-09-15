import { Logger } from '@nestjs/common'
import { TerminalOrdersBroadcastListener } from './terminal-orders-broadcast.listener'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TerminalStateCacheService } from './terminal-state-cache.service'
import type { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'

const TERMINAL_ID = 23_892
const TRADER_ID = 592
const CARD_ID = 100

const terminal = (over: Record<string, unknown> = {}) => ({
  terminalId: TERMINAL_ID,
  traderId: TRADER_ID,
  cardId: CARD_ID,
  terminalName: 'Прокрутка 12',
  cred3: 'https://send.monobank.ua/jar/abc?sendId=xyz',
  enabled: true,
  lastBalance: null,
  lastGoal: null,
  ...over,
})

describe('TerminalOrdersBroadcastListener', () => {
  let db: { findOne: jest.Mock }
  let cache: { getCurrentState: jest.Mock }
  let orchestrator: { broadcastBalanceUpdate: jest.Mock }
  let listener: TerminalOrdersBroadcastListener

  beforeEach(() => {
    db = { findOne: jest.fn().mockResolvedValue(terminal()) }
    cache = { getCurrentState: jest.fn().mockResolvedValue({ current: 120_000, goal: 235_000 }) }
    orchestrator = { broadcastBalanceUpdate: jest.fn().mockResolvedValue(undefined) }

    listener = new TerminalOrdersBroadcastListener(
      db as unknown as TerminalDbService,
      cache as unknown as TerminalStateCacheService,
      orchestrator as unknown as TerminalBalanceOrchestratorService,
    )

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  /**
   * The whole reason this listener exists. `pendingOrdersSum` used to reach the
   * dashboard only through the scraper, so an order arriving or being cancelled
   * over a webhook changed nothing the trader could see until the next poll —
   * and nothing at all when the polling loop was not running.
   */
  it('pushes the terminal to the extension when its orders change', async () => {
    await listener.handleOrdersChanged({ cardId: CARD_ID })

    expect(orchestrator.broadcastBalanceUpdate).toHaveBeenCalledWith(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'Прокрутка 12',
      'xyz',
      120_000,
      235_000,
    )
  })

  it('falls back to the persisted figures when Redis has none', async () => {
    cache.getCurrentState.mockResolvedValue(null)
    db.findOne.mockResolvedValue(terminal({ lastBalance: 90_000, lastGoal: 235_000 }))

    await listener.handleOrdersChanged({ cardId: CARD_ID })

    expect(orchestrator.broadcastBalanceUpdate).toHaveBeenCalledWith(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'Прокрутка 12',
      'xyz',
      90_000,
      235_000,
    )
  })

  it('reports zero when neither source has a balance', async () => {
    cache.getCurrentState.mockResolvedValue(null)

    await listener.handleOrdersChanged({ cardId: CARD_ID })

    expect(orchestrator.broadcastBalanceUpdate).toHaveBeenCalledWith(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'Прокрутка 12',
      'xyz',
      0,
      undefined,
    )
  })

  /**
   * The client's store *adds* a card for a balance event whose terminal it does
   * not already hold, and the dashboard only ever holds enabled ones. A stale
   * order finally being cancelled would otherwise make a switched-off jar
   * reappear on the dashboard out of nowhere.
   */
  it('says nothing for a disabled terminal', async () => {
    db.findOne.mockResolvedValue(terminal({ enabled: false }))

    await listener.handleOrdersChanged({ cardId: CARD_ID })

    expect(orchestrator.broadcastBalanceUpdate).not.toHaveBeenCalled()
  })

  /** Order webhooks carry only `card_id`, and the sync may not have run yet. */
  it('warns rather than throwing when no terminal is stored for the card', async () => {
    db.findOne.mockResolvedValue(null)

    await listener.handleOrdersChanged({ cardId: CARD_ID })

    expect(orchestrator.broadcastBalanceUpdate).not.toHaveBeenCalled()
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining(String(CARD_ID)))
  })

  it('warns when the event names no card at all', async () => {
    await listener.handleOrdersChanged({})

    expect(db.findOne).not.toHaveBeenCalled()
    expect(orchestrator.broadcastBalanceUpdate).not.toHaveBeenCalled()
  })

  /**
   * This runs off the back of an order write. Refreshing a number on a screen
   * must never be able to undo one.
   */
  it('swallows a broadcast failure', async () => {
    orchestrator.broadcastBalanceUpdate.mockRejectedValue(new Error('redis is down'))

    await expect(listener.handleOrdersChanged({ cardId: CARD_ID })).resolves.toBeUndefined()
    expect(Logger.prototype.error).toHaveBeenCalled()
  })
})
