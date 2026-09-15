import { SaleTerminalService } from './sale-terminal.service'
import type { TerminalActivationService, TerminalDeactivationService } from 'src/modules/terminal'
import type { TmaServiceTraderService } from './tma-service-trader.service'

const CARD_ID = 100
const TRADER_ID = 346
const TERMINAL_ID = 23_892
const API_TOKEN = 'service-trader-token'

const terminalOf = (overrides: Record<string, unknown> = {}) => ({
  publicId: '4W3QASK2',
  cardId: CARD_ID,
  traderId: TRADER_ID,
  transactoTerminalId: TERMINAL_ID,
  ...overrides
})

/**
 * This class turns a sale into a deactivation request and does nothing
 * else. The teardown itself — Transacto, the alert, Mongo, Redis, and the order
 * they happen in — lives in `TerminalDeactivationService` and is tested there;
 * it used to be one of three copies that had drifted apart.
 */
describe('SaleTerminalService', () => {
  let deactivation: { deactivate: jest.Mock }
  let activation: { activate: jest.Mock }
  let service: SaleTerminalService

  beforeEach(() => {
    deactivation = { deactivate: jest.fn().mockResolvedValue(undefined) }

    activation = { activate: jest.fn().mockResolvedValue(undefined) }

    service = new SaleTerminalService(
      deactivation as unknown as TerminalDeactivationService,
      activation as unknown as TerminalActivationService,
      {
        resolve: jest.fn().mockResolvedValue({ traderId: TRADER_ID, apiToken: API_TOKEN })
      } as unknown as TmaServiceTraderService
    )
  })

  it('hands the terminal over with the service trader token', async () => {
    await service.disable(terminalOf(), 'Completed')

    expect(deactivation.deactivate).toHaveBeenCalledWith({
      terminalId: TERMINAL_ID,
      traderId: TRADER_ID,
      cardId: CARD_ID,
      reason: 'Completed order 4W3QASK2',
      apiToken: API_TOKEN,
      settledKopecks: undefined
    })
  })

  /**
   * A credential is created with its turnover capped at its order's target, so
   * an order that closes short leaves headroom behind it. Only a completion
   * passes a settled figure; a cancellation is a teardown, not a settlement.
   */
  it('passes what the order settled for, when it settled for anything', async () => {
    await service.disable(terminalOf(), 'Completed', 85_000)

    expect(deactivation.deactivate).toHaveBeenCalledWith(
      expect.objectContaining({ settledKopecks: 85_000 })
    )
  })

  it('names the ending in the reason, so the log says which path ran', async () => {
    await service.disable(terminalOf(), 'Cancelled')

    expect(deactivation.deactivate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Cancelled order 4W3QASK2' })
    )
  })

  /**
   * An order that failed before Transacto answered has no card and no trader,
   * so there is no terminal to stand down.
   */
  it.each([
    ['no card', { cardId: null }],
    ['no trader', { traderId: null }]
  ])('does nothing for an order with %s', async (_label, missing) => {
    await service.disable(terminalOf(missing), 'Failed')

    expect(deactivation.deactivate).not.toHaveBeenCalled()
  })

  /**
   * A terminal id it never got is passed through as `null` rather than skipped:
   * the row still has to be disabled, and only the Redis keys are filed under
   * that id.
   */
  it('still stands the row down when Transacto never gave a terminal id', async () => {
    await service.disable(terminalOf({ transactoTerminalId: null }), 'Failed')

    expect(deactivation.deactivate).toHaveBeenCalledWith(
      expect.objectContaining({ terminalId: null, cardId: CARD_ID })
    )
  })
})
