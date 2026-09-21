import { AdminWsEventNames, AlertStatus, WsEventNames } from '@transacto/contracts'
import { AdminBroadcastService } from 'src/modules/admin/services/admin-broadcast.service'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { TraderWsEvent } from 'src/shared/interfaces'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { AdminDepositsService } from 'src/modules/admin/services/admin-deposits.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'

/**
 * The fan-out that makes the panel live.
 *
 * Every handler here subscribes to something the product already emitted, so
 * the failure mode is silence: a wrong event name or a missed case costs
 * nothing at runtime and simply stops a screen updating. Nothing else notices.
 */
describe('AdminBroadcastService', () => {
  const build = (listening = true) => {
    const gateway = { emit: jest.fn(), hasListeners: jest.fn(() => listening) }
    const terminalDb = { findOne: jest.fn(async () => null) }

    return {
      gateway,
      terminalDb,
      service: new AdminBroadcastService(
        gateway as unknown as AdminGateway,
        {} as TmaUserDbService,
        {} as TmaSaleDbService,
        // Both rails' rows come from here now, rather than from each
        // collection's own `-db` service. Nothing in this file exercises the
        // deposit handlers, so an empty stand-in is honest — but it has to be
        // the *right* stand-in, or the next person reading this file learns a
        // dependency that no longer exists.
        {} as AdminDepositsService,
        terminalDb as unknown as TerminalDbService
      )
    }
  }

  const HISTORY_ROW = {
    _id: 'row-1',
    cardId: 4242,
    traderId: 7,
    timestamp: new Date().toISOString(),
    balance: 389_800,
    baseline: 389_800,
    expectedBalance: 572_000,
    delta: 60_400,
    orderEvents: [{ orderId: 9001, amount: 60_400, status: 'EXECUTED' }],
    alerts: []
  }

  describe('terminal history', () => {
    /**
     * Forwarded verbatim, and that is the requirement: the panel renders these
     * rows through the very component the extension does, so a mapped or
     * narrowed payload would make the two screens show different things for one
     * scrape.
     */
    it('passes a history row through untouched', async () => {
      const { gateway, service } = build()

      await service.handleTraderEvent(
        new TraderWsEvent(7, WsEventNames.TERMINAL_HISTORY_UPDATED, HISTORY_ROW)
      )

      expect(gateway.emit).toHaveBeenCalledWith(
        AdminWsEventNames.TERMINAL_HISTORY_APPENDED,
        HISTORY_ROW
      )
    })

    it('does not re-read the terminal for a history row', async () => {
      const { terminalDb, service } = build()

      await service.handleTraderEvent(
        new TraderWsEvent(7, WsEventNames.TERMINAL_HISTORY_UPDATED, HISTORY_ROW)
      )

      // The payload is already the whole record; a lookup would only add a way
      // for the two views of one scrape to disagree.
      expect(terminalDb.findOne).not.toHaveBeenCalled()
    })

    it('costs nothing when no operator is connected', async () => {
      const { gateway, service } = build(false)

      await service.handleTraderEvent(
        new TraderWsEvent(7, WsEventNames.TERMINAL_HISTORY_UPDATED, HISTORY_ROW)
      )

      expect(gateway.emit).not.toHaveBeenCalled()
    })
  })

  describe('other trader events', () => {
    it('maps an alert off its payload rather than re-reading it', async () => {
      const { gateway, service } = build()

      await service.handleTraderEvent(
        new TraderWsEvent(7, WsEventNames.TERMINAL_ALERT_TRIGGERED, {
          id: 'alert-1',
          traderId: 7,
          terminalId: 77,
          type: 'FRAUD',
          status: AlertStatus.PENDING,
          amount: 1234,
          isRead: false,
          createdAt: new Date()
        })
      )

      expect(gateway.emit).toHaveBeenCalledWith(
        AdminWsEventNames.ALERT_UPDATED,
        expect.objectContaining({ alert: expect.objectContaining({ id: 'alert-1' }) })
      )
    })

    it('ignores an event the panel has no row for', async () => {
      const { gateway, service } = build()

      await service.handleTraderEvent(
        new TraderWsEvent(7, WsEventNames.TRADER_DEACTIVATED, { traderId: 7 })
      )

      expect(gateway.emit).not.toHaveBeenCalled()
    })

    /**
     * Every emitter is on a hot path — a scrape, a settlement — and
     * EventEmitter2 is synchronous, so an exception raised here would surface
     * inside the thing that emitted it. A dashboard must never fail a payment.
     */
    it('swallows a handler failure rather than breaking the emitter', async () => {
      const { gateway, service } = build()
      gateway.emit.mockImplementation(() => {
        throw new Error('socket exploded')
      })

      await expect(
        service.handleTraderEvent(
          new TraderWsEvent(7, WsEventNames.TERMINAL_HISTORY_UPDATED, HISTORY_ROW)
        )
      ).resolves.toBeUndefined()
    })
  })
})
