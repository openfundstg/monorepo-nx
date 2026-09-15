import { TerminalSource, WsEventNames } from '@transacto/contracts'
import { TerminalBroadcastService } from './terminal-broadcast.service'
import { BankProvider } from 'src/shared/constants/bank.constants'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import type { OrderDbService } from 'src/modules/repositories/order-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TerminalUrlResolverService } from './terminal-url-resolver.service'

const TRADER_ID = 346
const TERMINAL_ID = 23_892
const CARD_ID = 100
const JAR_URL = 'https://send.monobank.ua/widget.html?jar=abc&sendId=xyz'

const stored = (over: Record<string, unknown> = {}) =>
  ({
    traderId: TRADER_ID,
    terminalId: TERMINAL_ID,
    cardId: CARD_ID,
    terminalName: 'TMA-8F4808RP',
    cred3: JAR_URL,
    enabled: true,
    source: TerminalSource.TMA,
    lastBalance: 85_000,
    lastGoal: 100_000,
    lastBalanceAt: new Date('2026-08-27T10:00:00.000Z'),
    ...over,
  }) as never

/**
 * `terminal.enabled` and `terminal.disabled` were declared on both sides of the
 * socket and emitted by nobody. The events existed, the client listened for
 * them, and no line of backend code had ever sent one — so a terminal created
 * or switched off only reached the dashboard on a reload.
 */
describe('TerminalBroadcastService', () => {
  let orders: { getPendingOrdersForCard: jest.Mock }
  let sales: { findRemainderPoliciesByCardIds: jest.Mock }
  let emitter: { emit: jest.Mock }
  let service: TerminalBroadcastService

  const emitted = () => emitter.emit.mock.calls[0][1]

  beforeEach(() => {
    orders = { getPendingOrdersForCard: jest.fn().mockResolvedValue([]) }
    sales = { findRemainderPoliciesByCardIds: jest.fn().mockResolvedValue(new Map()) }
    emitter = { emit: jest.fn() }

    service = new TerminalBroadcastService(
      orders as unknown as OrderDbService,
      sales as unknown as TmaSaleDbService,
      { resolve: () => JAR_URL } as unknown as TerminalUrlResolverService,
      emitter as unknown as EventEmitter2,
    )
  })

  describe('a terminal the trader can now see', () => {
    it('goes to that trader alone', async () => {
      await service.announceEnabled(stored())

      const [channel, envelope] = emitter.emit.mock.calls[0]
      expect(channel).toBe('ws.emit')
      expect(envelope.traderId).toBe(TRADER_ID)
      expect(envelope.event).toBe(WsEventNames.TERMINAL_ENABLED)
    })

    /**
     * The whole point of the widened payload: the card is complete the moment
     * it appears, rather than an empty row that fills in when the scraper next
     * runs. Every figure here is already stored.
     */
    it('carries a card the client can render without asking anything', async () => {
      await service.announceEnabled(stored())

      expect(emitted().data).toMatchObject({
        terminalId: TERMINAL_ID,
        cardId: CARD_ID,
        terminalName: 'TMA-8F4808RP',
        source: TerminalSource.TMA,
        bankProvider: BankProvider.MONO,
        url: JAR_URL,
        balance: 85_000,
        goal: 100_000,
        sendId: 'xyz',
      })
    })

    /** From the persisted figures, not from a scrape that has not happened. */
    it('dates the figures it is quoting', async () => {
      await service.announceEnabled(stored())

      expect(emitted().data.balanceAt).toBe('2026-08-27T10:00:00.000Z')
    })

    /**
     * A jar nobody has ever scraped and no order has ever targeted. Zero rather
     * than a missing field, because the card needs a number for its bar.
     */
    it('reports zero for a terminal with nothing on record', async () => {
      await service.announceEnabled(stored({ lastBalance: null, lastGoal: null, lastBalanceAt: null }))

      expect(emitted().data).toMatchObject({ balance: 0, goal: undefined, balanceAt: undefined })
    })

    it('totals the money already on its way in', async () => {
      orders.getPendingOrdersForCard.mockResolvedValue([{ amount: 30_000 }, { amount: 20_000 }])

      await service.announceEnabled(stored())

      expect(emitted().data).toMatchObject({ hasPendingOrders: true, pendingOrdersSum: 50_000 })
    })

    /**
     * ISO, matching a dashboard row rather than the epoch milliseconds the
     * balance event uses — one mapper on the client reads both.
     */
    it('timestamps itself the way a dashboard row does', async () => {
      await service.announceEnabled(stored())

      expect(typeof emitted().data.updatedAt).toBe('string')
      expect(Number.isNaN(Date.parse(emitted().data.updatedAt))).toBe(false)
    })

    /**
     * Announcing a terminal matters less than creating it. A failure here must
     * not surface as a failed sale.
     */
    it('says nothing rather than throwing when a lookup fails', async () => {
      orders.getPendingOrdersForCard.mockRejectedValue(new Error('mongo is down'))

      await expect(service.announceEnabled(stored())).resolves.toBeUndefined()
      expect(emitter.emit).not.toHaveBeenCalled()
    })
  })

  describe('a terminal that is gone', () => {
    it('names it, and nothing more', () => {
      service.announceDisabled(TRADER_ID, TERMINAL_ID, CARD_ID)

      const [, envelope] = emitter.emit.mock.calls[0]
      expect(envelope.event).toBe(WsEventNames.TERMINAL_DISABLED)
      expect(envelope.data).toEqual({ terminalId: TERMINAL_ID, cardId: CARD_ID })
    })
  })
})
