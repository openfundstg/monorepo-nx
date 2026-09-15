import { TerminalErrorHandlerService } from './terminal-error-handler.service'
import type { TerminalDeactivationService } from 'src/modules/terminal'
import type { OrderDbService } from 'src/modules/repositories/order-db'
import type { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { TerminalStateCacheService } from './terminal-state-cache.service'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TERMINAL_ID = 23715
const TRADER_ID = 346
const CARD_ID = 100

describe('TerminalErrorHandlerService', () => {
  let deactivation: { deactivate: jest.Mock }
  let orders: { failPendingOrdersForCard: jest.Mock }
  let sales: { markJarClosedByCardId: jest.Mock }
  let service: TerminalErrorHandlerService

  beforeEach(() => {
    deactivation = { deactivate: jest.fn().mockResolvedValue(undefined) }
    orders = { failPendingOrdersForCard: jest.fn().mockResolvedValue(undefined) }
    sales = { markJarClosedByCardId: jest.fn().mockResolvedValue(1) }

    service = new TerminalErrorHandlerService(
      deactivation as unknown as TerminalDeactivationService,
      orders as unknown as OrderDbService,
      { } as unknown as AlertsService,
      { } as unknown as TerminalStateCacheService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      sales as unknown as TmaSaleDbService,
    )
  })

  const deadJar = () =>
    service.handleDeadJar(TERMINAL_ID, TRADER_ID, CARD_ID, 'token', 'bank reports the jar closed')

  describe('a jar the bank reports closed', () => {
    it('takes the terminal out of service', async () => {
      await deadJar()

      expect(deactivation.deactivate).toHaveBeenCalledWith(
        expect.objectContaining({ terminalId: TERMINAL_ID, cardId: CARD_ID }),
      )
    })

    it('fails the orders that can no longer be paid', async () => {
      await deadJar()

      expect(orders.failPendingOrdersForCard).toHaveBeenCalledWith(CARD_ID)
    })

    /**
     * The only place that ever learns a jar has been closed — the scraper is
     * what asks the bank. A Mini App user's next sale slot, and the
     * stake behind an order they stopped themselves, are both waiting on this.
     */
    it('records the closure against the sale', async () => {
      await deadJar()

      expect(sales.markJarClosedByCardId).toHaveBeenCalledWith(CARD_ID)
    })

    /** Most terminals are a trader's own and have no sale behind them. */
    it('is untroubled when no sale matches the card', async () => {
      sales.markJarClosedByCardId.mockResolvedValue(0)

      await expect(deadJar()).resolves.toBeUndefined()
    })
  })
})
