import { TerminalsSyncService, TerminalSyncGuard } from './terminals-sync.service'
import type { TraderDbService } from 'src/modules/repositories/trader-db/services'
import type { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TerminalDeactivationService } from './terminal-deactivation.service'
import type { TerminalBroadcastService } from './terminal-broadcast.service'

const TRADER_ID = 346
const JAR_URL = 'https://send.monobank.ua/jar/Z38SL69F'

/** Comfortably before any `Date.now()` a test will observe. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

/** As Transacto's `credentials_list` returns them. */
const upstream = (cardId: number, terminalId: number) => ({
  card_id: cardId,
  terminal_id: terminalId,
  terminal_name: `T-${terminalId}`,
  cred3: JAR_URL,
  enable_orders: true,
})

/** As we hold them locally. */
const stored = (cardId: number, terminalId: number, enabled = true) => ({
  traderId: TRADER_ID,
  cardId,
  terminalId,
  terminalName: `T-${terminalId}`,
  cred3: JAR_URL,
  enabled,
  createdAt: LONG_AGO,
})

/** The `$set` a bulkWrite op carries, whatever else is on the op. */
const setOf = (op: any) => op.updateOne.update.$set

describe('TerminalsSyncService', () => {
  let traders: { findAllActive: jest.Mock }
  let transacto: { getTerminalsList: jest.Mock }
  let terminals: {
    find: jest.Mock
    findOne: jest.Mock
    updateOne: jest.Mock
    bulkWrite: jest.Mock
  }
  let deactivation: { deactivate: jest.Mock }
  let broadcast: { announceEnabled: jest.Mock }
  let service: TerminalsSyncService

  /**
   * `find` serves two different queries. The deletion check asks for
   * `{ enabled: true }`; the upsert pass asks for the trader's whole estate to
   * decide which log line each terminal deserves.
   */
  const localTerminals = (active: unknown[], all: unknown[] = active) => {
    terminals.find.mockImplementation(async (query: Record<string, unknown>) =>
      query.enabled === true ? active : all,
    )
  }

  /** Runs `count` full sync passes, as the cron would. */
  const syncTimes = async (count: number) => {
    for (let pass = 0; pass < count; pass += 1) await service.syncTerminals()
  }

  beforeEach(() => {
    traders = {
      findAllActive: jest.fn().mockResolvedValue([{ traderId: TRADER_ID, apiToken: 'token' }]),
    }
    transacto = { getTerminalsList: jest.fn().mockResolvedValue([]) }
    terminals = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      bulkWrite: jest.fn().mockResolvedValue(undefined),
    }
    deactivation = { deactivate: jest.fn().mockResolvedValue(undefined) }
    broadcast = { announceEnabled: jest.fn().mockResolvedValue(undefined) }

    service = new TerminalsSyncService(
      traders as unknown as TraderDbService,
      transacto as unknown as TransactoApiService,
      terminals as unknown as TerminalDbService,
      deactivation as unknown as TerminalDeactivationService,
      broadcast as unknown as TerminalBroadcastService,
    )
  })

  describe('terminals removed from Transacto', () => {
    it('deactivates one that is no longer listed', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715), stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate).toHaveBeenCalledWith(
        expect.objectContaining({ terminalId: 23_892, traderId: TRADER_ID, cardId: 200 }),
      )
    })

    /**
     * The one intentional difference between the three teardowns: this
     * credential has vanished from `credentials_list`, so there is nothing left
     * upstream to switch off or archive.
     */
    it('does not try to tell Transacto about a terminal Transacto has lost', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715), stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate.mock.calls[0][0].apiToken).toBeUndefined()
    })

    /**
     * One missed read is not evidence. `credentials_list` is unpaginated over a
     * list that grows with every sale, so a truncated or partial
     * response is indistinguishable here from a deletion — and standing a
     * terminal down clears its Redis state and stops its scraper loop.
     */
    it('waits for consecutive misses before standing a terminal down', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715), stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION - 1)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    /** A terminal that comes back starts its streak over. */
    it('resets the streak when the terminal reappears upstream', async () => {
      localTerminals([stored(100, 23715), stored(200, 23892)])

      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION - 1)

      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715), upstream(200, 23892)])
      await service.syncTerminals()

      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      await service.syncTerminals()

      expect(terminals.updateOne).not.toHaveBeenCalled()
    })

    /**
     * The regression that made Mini App terminals switch themselves off within
     * a minute of being created.
     *
     * A sale writes its terminal row — enabled, and correct — the
     * moment Transacto hands back the credential. If that lands after this pass
     * fetched the upstream list, the row is legitimately absent from a snapshot
     * taken before it existed, and reading that as a deletion killed the jar
     * seconds after the user was told it was ready.
     */
    it('never deactivates a row created after the upstream snapshot was taken', async () => {
      const justCreated = { ...stored(999, 40001), createdAt: new Date(Date.now() + 60_000) }

      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715), justCreated])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION + 2)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    /** History is the reason this deactivates instead of deleting. */
    it('never deletes the row', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(terminals).not.toHaveProperty('deleteOne')
      expect(deactivation.deactivate).toHaveBeenCalled()
    })

    it('leaves a terminal that is still listed alone', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    /**
     * The failure mode worth guarding hardest. `getTerminalsList` ends in
     * `?? []`, so an auth failure or a changed response shape yields an empty
     * array that is indistinguishable from "no terminals" — and acting on it
     * would disable every terminal this trader owns in a single pass.
     */
    it('refuses to act on an empty list from Transacto', async () => {
      transacto.getTerminalsList.mockResolvedValue([])
      localTerminals([stored(100, 23715), stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    /**
     * The empty-list guard at one step in. A response that lists one of four
     * terminals is a truncated page far more often than it is three deletions,
     * and acting on it takes most of a trader's estate offline at once.
     */
    it('refuses to stand down more than half a trader’s estate in one pass', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([
        stored(100, 23715),
        stored(200, 23892),
        stored(300, 23893),
        stored(400, 23894),
      ])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION + 1)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    /**
     * The share guard only says anything about a group. On a trader with one
     * or two terminals, one going away is always more than half of them — so
     * measuring the share alone would mean a small trader's terminals could
     * never be stood down at all.
     */
    it('still stands down a lone terminal on a one-terminal trader', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(200, 23892)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate).toHaveBeenCalledWith(
        expect.objectContaining({ traderId: TRADER_ID, cardId: 200 }),
      )
    })

    /**
     * The sync only upserts terminals whose cred3 is a bank URL, but the
     * deletion check must see the unfiltered list — otherwise every terminal
     * pointing somewhere else is judged deleted on every pass.
     */
    it('does not treat a non-bank terminal as deleted', async () => {
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(300, 24000), cred3: 'https://example.test/not-a-bank' },
      ])
      localTerminals([stored(300, 24000)])

      await syncTimes(TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION)

      expect(deactivation.deactivate).not.toHaveBeenCalled()
    })

    it('only considers terminals that are currently enabled', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])

      await service.syncTerminals()

      expect(terminals.find).toHaveBeenCalledWith({ traderId: TRADER_ID, enabled: true })
    })

    /**
     * Ordering is load-bearing: `loopActive` is one of the cleared keys, and the
     * watchdog revives a loop for an enabled terminal whose heartbeat is
     * missing. Clearing first would restart the loop being shut down.
     */
  })

  describe('local enabled state', () => {
    it('follows enable_orders when Transacto reports it', async () => {
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(100, 23715), enable_orders: false },
      ])

      await service.syncTerminals()

      expect(setOf(terminals.bulkWrite.mock.calls[0][0][0])).toEqual(
        expect.objectContaining({ enabled: false }),
      )
    })

    /**
     * `enable_orders` is optional on the response and used to be read as
     * `?? false`, so a rename, an omission or any unexpected shape disabled
     * every terminal of every trader on the next tick — one minute later. The
     * empty-list guard exists for exactly that class of failure and did not
     * cover this one.
     */
    it('leaves an existing row alone when Transacto omits enable_orders', async () => {
      const { enable_orders, ...silent } = upstream(100, 23715)
      transacto.getTerminalsList.mockResolvedValue([silent])

      await service.syncTerminals()

      const op = terminals.bulkWrite.mock.calls[0][0][0]
      expect(setOf(op)).not.toHaveProperty('enabled')
    })

    /**
     * The exception that holds the whole winding-down design together.
     *
     * When a Mini App user stops an order with payments still outstanding, we
     * ourselves set `enable_orders: 0` upstream — while deliberately keeping the
     * terminal in service, because a payer already holding an order can still
     * pay and only the scrape sees that money. Reading the flag back here would
     * disable the terminal on the very next pass, a minute later, stop the
     * scrape, and let the jar take a late payment silently. The order would then
     * refund the entire stake while the user kept the hryvnia.
     */
    it('leaves a winding-down terminal enabled despite enable_orders being off', async () => {
      terminals.find.mockResolvedValue([
        { traderId: TRADER_ID, cardId: 100, enabled: true, acceptingOrders: false },
      ])
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(100, 23715), enable_orders: false },
      ])

      await service.syncTerminals()

      expect(setOf(terminals.bulkWrite.mock.calls[0][0][0])).not.toHaveProperty('enabled')
    })

    /**
     * The exception is for that window and no longer. A terminal already torn
     * down has to stay re-enablable from upstream like any other — otherwise a
     * leftover flag would pin it off for good.
     */
    it('still follows enable_orders once the terminal is disabled', async () => {
      terminals.find.mockResolvedValue([
        { traderId: TRADER_ID, cardId: 100, enabled: false, acceptingOrders: false },
      ])
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(100, 23715), enable_orders: true },
      ])

      await service.syncTerminals()

      expect(setOf(terminals.bulkWrite.mock.calls[0][0][0])).toEqual(
        expect.objectContaining({ enabled: true }),
      )
    })

    /** An ordinary terminal is unaffected by any of this. */
    it('follows enable_orders for a terminal routing normally', async () => {
      terminals.find.mockResolvedValue([
        { traderId: TRADER_ID, cardId: 100, enabled: true, acceptingOrders: true },
      ])
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(100, 23715), enable_orders: false },
      ])

      await service.syncTerminals()

      expect(setOf(terminals.bulkWrite.mock.calls[0][0][0])).toEqual(
        expect.objectContaining({ enabled: false }),
      )
    })

    /** A terminal we know nothing about starts off, not on the schema default. */
    it('inserts an unreported terminal disabled', async () => {
      const { enable_orders, ...silent } = upstream(100, 23715)
      transacto.getTerminalsList.mockResolvedValue([silent])

      await service.syncTerminals()

      const op = terminals.bulkWrite.mock.calls[0][0][0]
      expect(op.updateOne.update.$setOnInsert).toEqual({ enabled: false })
    })

    /** `$set` and `$setOnInsert` may never both carry `enabled` — Mongo rejects it. */
    it('never writes enabled through both operators at once', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])

      await service.syncTerminals()

      const op = terminals.bulkWrite.mock.calls[0][0][0]
      expect(op.updateOne.update.$set.enabled).toBe(true)
      expect(op.updateOne.update.$setOnInsert).toBeUndefined()
    })

    /**
     * This used to be a `findOne` per terminal, awaited in sequence purely to
     * pick a log line — and every one of those round trips widened the window
     * between the upstream snapshot and the deletion check that reads it.
     */
    it('reads the trader’s terminals a fixed number of times, however many there are', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      await service.syncTerminals()
      const forOne = terminals.find.mock.calls.length

      terminals.find.mockClear()
      transacto.getTerminalsList.mockResolvedValue([
        upstream(100, 23715),
        upstream(200, 23892),
        upstream(300, 23893),
        upstream(400, 23894),
        upstream(500, 23895),
      ])
      await service.syncTerminals()

      expect(terminals.findOne).not.toHaveBeenCalled()
      // Five terminals cost exactly what one does: the deletion check, the
      // existing map, and one batched re-read of whatever became visible.
      expect(terminals.find).toHaveBeenCalledTimes(forOne)
    })
  })

  it('does nothing when there are no active traders', async () => {
    traders.findAllActive.mockResolvedValue([])

    await service.syncTerminals()

    expect(transacto.getTerminalsList).not.toHaveBeenCalled()
    expect(terminals.updateOne).not.toHaveBeenCalled()
  })

  /** One trader's failure must not stop the others being synced. */
  it('survives Transacto failing for a single trader', async () => {
    traders.findAllActive.mockResolvedValue([
      { traderId: 1, apiToken: 'a' },
      { traderId: 2, apiToken: 'b' },
    ])
    transacto.getTerminalsList
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValueOnce([upstream(100, 23715)])

    await expect(service.syncTerminals()).resolves.toBeUndefined()
    expect(transacto.getTerminalsList).toHaveBeenCalledTimes(2)
  })

  /**
   * `terminal.enabled` was declared on both sides of the socket and emitted by
   * nobody, so a terminal that appeared upstream only reached the trader's
   * dashboard on a reload — or sideways, minutes later, when the scraper
   * happened to broadcast a balance for a card the client did not know.
   */
  describe('terminals the trader can now see', () => {
    /**
     * `find` serves three queries here. The announce re-read is the one asking
     * for specific cards, so it is told apart by `cardId` rather than by call
     * order — which changes whenever the sync's internals do.
     */
    const localTerminalsAndWrites = (active: unknown[], all: unknown[], written: unknown[]) => {
      terminals.find.mockImplementation(async (query: Record<string, unknown>) => {
        if (query.cardId) return written
        return query.enabled === true ? active : all
      })
    }

    it('announces one that has just appeared', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminalsAndWrites([], [], [stored(100, 23715)])

      await service.syncTerminals()

      expect(broadcast.announceEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 100 }),
      )
    })

    it('announces one that was switched back on upstream', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminalsAndWrites([], [stored(100, 23715, false)], [stored(100, 23715)])

      await service.syncTerminals()

      expect(broadcast.announceEnabled).toHaveBeenCalled()
    })

    /** Every pass but the few where something actually changes. */
    it('says nothing about a terminal that was already on', async () => {
      transacto.getTerminalsList.mockResolvedValue([upstream(100, 23715)])
      localTerminals([stored(100, 23715)])

      await service.syncTerminals()

      expect(broadcast.announceEnabled).not.toHaveBeenCalled()
    })

    /**
     * `enable_orders` absent means upstream said nothing, so nothing changed
     * here either — see `resolveEnabled`.
     */
    it('says nothing when upstream reported no enablement at all', async () => {
      transacto.getTerminalsList.mockResolvedValue([
        { ...upstream(100, 23715), enable_orders: undefined },
      ])
      localTerminals([])

      await service.syncTerminals()

      expect(broadcast.announceEnabled).not.toHaveBeenCalled()
    })
  })
})

