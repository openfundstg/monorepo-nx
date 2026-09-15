import type Redis from 'ioredis'
import { TerminalDeactivationService } from './terminal-deactivation.service'
import { AlertType } from 'src/modules/repositories/alerts-db/schemas'
import { terminalRedisKeys } from 'src/shared/redis'
import type { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import type { TerminalBroadcastService } from './terminal-broadcast.service'

const TERMINAL_ID = 23_892
const TRADER_ID = 346
const CARD_ID = 100
const API_TOKEN = 'token'

const request = (over: Record<string, unknown> = {}) => ({
  terminalId: TERMINAL_ID,
  traderId: TRADER_ID,
  cardId: CARD_ID,
  reason: 'Completed order Z38SL69F',
  apiToken: API_TOKEN,
  ...over,
})

describe('TerminalDeactivationService', () => {
  let terminals: { updateOne: jest.Mock }
  let transacto: { updateTerminals: jest.Mock }
  let alerts: { resolvePendingAlertsForJar: jest.Mock }
  let redis: { del: jest.Mock }
  let broadcast: { announceDisabled: jest.Mock }
  let service: TerminalDeactivationService

  beforeEach(() => {
    terminals = { updateOne: jest.fn().mockResolvedValue(undefined) }
    transacto = { updateTerminals: jest.fn().mockResolvedValue(undefined) }
    alerts = { resolvePendingAlertsForJar: jest.fn().mockResolvedValue([]) }
    redis = { del: jest.fn().mockResolvedValue(1) }
    broadcast = { announceDisabled: jest.fn() }

    service = new TerminalDeactivationService(
      terminals as unknown as TerminalDbService,
      transacto as unknown as TransactoApiService,
      alerts as unknown as AlertsService,
      broadcast as unknown as TerminalBroadcastService,
      redis as unknown as Redis,
    )
  })

  describe('upstream', () => {
    /**
     * Both flags. A credential left with `enable_orders: 1` keeps taking
     * orders, and the next terminals sync reads that flag back and re-enables
     * the local row — so a half teardown does not stay torn down.
     */
    it('switches the credential off', async () => {
      await service.deactivate(request())

      expect(transacto.updateTerminals).toHaveBeenCalledWith(
        API_TOKEN,
        expect.objectContaining({ card_id: CARD_ID, enabled: 0, enable_orders: 0 }),
      )
    })

    /**
     * Archiving would be the only way to make `terminal_is_active` false, and
     * it cannot be undone — an archived credential has to be created again with
     * a new `card_id` and `terminal_id`. Standing a terminal down is reversible,
     * which matters most on the fraud path: that fires on *any* balance
     * decrease and raises a suspicion for a human to review. So the flag stays
     * `true` on a disabled terminal, on purpose.
     */
    it('never archives the credential', async () => {
      await service.deactivate(request())

      expect(transacto).not.toHaveProperty('deleteCredential')
    })

    /**
     * The one intentional difference between the three teardowns. The terminals
     * sync stands down a credential that has vanished from `credentials_list`;
     * there is nothing left there to switch off or archive.
     */
    it('says nothing to Transacto without a token', async () => {
      await service.deactivate(request({ apiToken: undefined }))

      expect(transacto.updateTerminals).not.toHaveBeenCalled()
    })

    /** Only a completion passes one; see the doc on `settledKopecks`. */
    it('brings the turnover caps down to what was settled', async () => {
      await service.deactivate(request({ settledKopecks: 85_000 }))

      expect(transacto.updateTerminals).toHaveBeenCalledWith(
        API_TOKEN,
        expect.objectContaining({ max_turnover: 850, max_turnover_daily: 850, limit_by_day: 850 }),
      )
    })

    it('leaves the caps alone on a teardown that settled nothing', async () => {
      await service.deactivate(request())

      const [, body] = transacto.updateTerminals.mock.calls[0]
      expect(body).not.toHaveProperty('max_turnover')
      expect(body).not.toHaveProperty('limit_by_day')
    })
  })

  describe('the local writes', () => {
    /**
     * The bug this consolidation removes. The scraper's error handler had the
     * Transacto call and the Mongo write in one `try`, so a Transacto hiccup
     * skipped the local write and left the terminal enabled here — with the
     * scraper polling a credential nobody would ever route to again.
     */
    it('disables the row even when Transacto refuses', async () => {
      transacto.updateTerminals.mockRejectedValue(new Error('503'))

      await service.deactivate(request())

      expect(terminals.updateOne).toHaveBeenCalledWith(
        { traderId: TRADER_ID, cardId: CARD_ID },
        { $set: { enabled: false, acceptingOrders: true } },
      )
    })

    it('clears the cache even when Transacto refuses', async () => {
      transacto.updateTerminals.mockRejectedValue(new Error('503'))

      await service.deactivate(request())

      expect(redis.del).toHaveBeenCalledWith(...terminalRedisKeys(TERMINAL_ID))
    })

    /**
     * `loopActive` is among the keys cleared, and the watchdog reads a missing
     * heartbeat on an *enabled* terminal as a loop to revive — so clearing
     * first would restart the very loop this is shutting down.
     */
    it('marks the row disabled before clearing the cache', async () => {
      const order: string[] = []
      terminals.updateOne.mockImplementation(async () => {
        order.push('mongo')
      })
      redis.del.mockImplementation(async () => {
        order.push('redis')
        return 1
      })

      await service.deactivate(request())

      expect(order).toEqual(['mongo', 'redis'])
    })

    /**
     * A sale that failed before Transacto answered has no terminal id,
     * and the Redis keys are filed under exactly that.
     */
    it('skips the cache clear when there is no upstream terminal id', async () => {
      await service.deactivate(request({ terminalId: null }))

      expect(redis.del).not.toHaveBeenCalled()
      expect(terminals.updateOne).toHaveBeenCalled()
    })

    it('never throws, whatever fails', async () => {
      transacto.updateTerminals.mockRejectedValue(new Error('503'))
      alerts.resolvePendingAlertsForJar.mockRejectedValue(new Error('mongo is down'))

      await expect(service.deactivate(request())).resolves.toBeUndefined()
    })
  })

  describe('the alerts it leaves behind', () => {
    /**
     * "Jar almost full" asks a trader to pay the last stretch in by hand. Once
     * the terminal is out of service nobody ever will — and nothing is left to
     * clear it either, because the check that resolves one only runs on a
     * scrape. An unread alert keeps a disabled terminal in the "active jars".
     */
    it('clears the jar-full warning', async () => {
      await service.deactivate(request())

      expect(alerts.resolvePendingAlertsForJar).toHaveBeenCalledWith(TERMINAL_ID, [
        AlertType.TERMINAL_FULL_WARNING,
      ])
    })

    /**
     * And nothing else. An unrecognised deposit, an ambiguous one, a fraud
     * suspicion or an order still awaiting confirmation all want a human after
     * the terminal is gone; clearing those would hide them.
     */
    it('leaves every other kind alone', async () => {
      await service.deactivate(request())

      const [, types] = alerts.resolvePendingAlertsForJar.mock.calls[0]
      expect(types).toEqual([AlertType.TERMINAL_FULL_WARNING])
    })

    it('finishes the teardown when resolving fails', async () => {
      alerts.resolvePendingAlertsForJar.mockRejectedValue(new Error('mongo is down'))

      await service.deactivate(request())

      expect(terminals.updateOne).toHaveBeenCalled()
      expect(redis.del).toHaveBeenCalled()
    })
  })

  /**
   * `terminal.disabled` was declared on both sides of the socket and emitted by
   * nobody, so a terminal taken out of service stayed on the trader's dashboard
   * until they reloaded.
   */
  describe('telling the extension', () => {
    it('announces the terminal as gone', async () => {
      await service.deactivate(request())

      expect(broadcast.announceDisabled).toHaveBeenCalledWith(TRADER_ID, TERMINAL_ID, CARD_ID)
    })

    /**
     * Last, and only once everything else is done. The client drops the card on
     * this, so announcing earlier would take it off screen while the terminal
     * was still half in service.
     */
    it('announces only after the row and the cache are settled', async () => {
      const order: string[] = []
      terminals.updateOne.mockImplementation(async () => {
        order.push('mongo')
      })
      redis.del.mockImplementation(async () => {
        order.push('redis')
        return 1
      })
      broadcast.announceDisabled.mockImplementation(() => {
        order.push('announce')
      })

      await service.deactivate(request())

      expect(order).toEqual(['mongo', 'redis', 'announce'])
    })

    /** Nothing to name, and the client keys its cards on the terminal id. */
    it('says nothing when there is no terminal id', async () => {
      await service.deactivate(request({ terminalId: null }))

      expect(broadcast.announceDisabled).not.toHaveBeenCalled()
    })
  })
})
