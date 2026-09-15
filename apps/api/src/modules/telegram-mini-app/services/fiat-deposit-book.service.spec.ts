import { FiatDepositBookService } from './fiat-deposit-book.service'
import {
  TransactoPanelCurrencyId,
  TransactoPayoutStatus,
  TransactoPayoutType
} from 'src/shared/interfaces/transacto-panel.interface'
import { panelPayoutRow } from 'src/modules/transacto/testing'
import type Redis from 'ioredis'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import type { FiatDepositWatchService } from './fiat-deposit-watch.service'

/**
 * Enough Redis to hold one snapshot, **including its clock**.
 *
 * The expiry is modelled rather than ignored because the bug this file now
 * guards against was invisible without it: every command answered correctly and
 * the offer still emptied itself, because nothing renewed the key. `elapse`
 * moves time the way the cron's own gaps do.
 */
const redisDouble = () => {
  const store = new Map<string, { value: string; expiresIn: number }>()

  return {
    store,
    /** Moves the clock forward, dropping whatever ran out on the way. */
    elapse: (seconds: number) => {
      for (const [key, entry] of store) {
        entry.expiresIn -= seconds
        if (entry.expiresIn <= 0) store.delete(key)
      }
    },
    client: {
      get: async (key: string) => store.get(key)?.value ?? null,
      set: async (key: string, value: string, _mode: string, expiresIn: number) => {
        store.set(key, { value, expiresIn })
        return 'OK'
      },
      expire: async (key: string, expiresIn: number) => {
        const entry = store.get(key)
        if (entry === undefined) return 0

        entry.expiresIn = expiresIn

        return 1
      },
      exists: async (key: string) => (store.has(key) ? 1 : 0)
    } as unknown as Redis
  }
}

describe('FiatDepositBookService', () => {
  let getOpenPayoutsCount: jest.Mock
  let getNewPayouts: jest.Mock
  let findHeldPayoutIds: jest.Mock
  let announce: jest.Mock
  let redis: ReturnType<typeof redisDouble>
  let service: FiatDepositBookService

  const build = () => {
    redis = redisDouble()

    return new FiatDepositBookService(
      { getOpenPayoutsCount, getNewPayouts } as unknown as TransactoPanelPayoutsApiService,
      { findHeldPayoutIds } as unknown as TmaFiatDepositDbService,
      { announce } as unknown as FiatDepositWatchService,
      redis.client
    )
  }

  beforeEach(() => {
    getOpenPayoutsCount = jest.fn().mockResolvedValue(3)
    getNewPayouts = jest.fn().mockResolvedValue({ rows: [panelPayoutRow()], unreadable: 0 })
    findHeldPayoutIds = jest.fn().mockResolvedValue([])
    announce = jest.fn().mockResolvedValue(undefined)
    // Both clocks are fake and both are moved by `tick`: the snapshot's TTL
    // lives in the double, and how long a count may be trusted is measured
    // against `Date.now()`. Moving one without the other models a machine that
    // does not exist.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T00:00:00Z'))
    service = build()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /** The two halves of `readOffer`, named for what each test is asserting. */
  const offeredAmounts = async (): Promise<number[]> => (await service.readOffer()).amountsUah
  const bookAvailable = async (): Promise<boolean> => (await service.readOffer()).available

  /** One cron gap, on both clocks at once. */
  const tick = async (seconds = 20) => {
    redis.elapse(seconds)
    jest.setSystemTime(Date.now() + seconds * 1000)
    await service.refresh()
  }

  describe('the offer', () => {
    it('caches the hryvnia card amounts, cheapest first and without repeats', async () => {
      getNewPayouts.mockResolvedValue({
        rows: [
          panelPayoutRow({ id: 1, amount: '2940.00' }),
          panelPayoutRow({ id: 2, amount: '600.00' }),
          panelPayoutRow({ id: 3, amount: '2940.00' })
        ],
        unreadable: 0
      })

      await service.refresh()

      await expect(offeredAmounts()).resolves.toEqual([60_000, 294_000])
    })

    it.each([
      ['a rouble payout', panelPayoutRow({ currency_id: TransactoPanelCurrencyId.RUB })],
      ['an SBP transfer', panelPayoutRow({ type: TransactoPayoutType.SBP })],
      ['one somebody already took', panelPayoutRow({ status: TransactoPayoutStatus.PENDING })]
    ])('never offers %s', async (_case, excluded) => {
      getNewPayouts.mockResolvedValue({ rows: [excluded], unreadable: 0 })

      await service.refresh()

      await expect(offeredAmounts()).resolves.toEqual([])
    })

    /** The whole point of the count: eleven kilobytes only when something moved. */
    it('does not re-read the table while the count stands still', async () => {
      await service.refresh()
      await service.refresh()

      expect(getOpenPayoutsCount).toHaveBeenCalledTimes(2)
      expect(getNewPayouts).toHaveBeenCalledTimes(1)
    })

    it('re-reads it the moment the count moves', async () => {
      await service.refresh()
      getOpenPayoutsCount.mockResolvedValue(4)
      await service.refresh()

      expect(getNewPayouts).toHaveBeenCalledTimes(2)
    })

    /**
     * A blip must not empty a screen that was right a moment ago — and a real
     * outage still empties it, because the snapshot expires on its own.
     */
    it('keeps the last good snapshot when the panel fails', async () => {
      await service.refresh()
      getOpenPayoutsCount.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.refresh()).resolves.toBeUndefined()
      await expect(offeredAmounts()).resolves.toEqual([60_000])
    })

    it('re-reads the table after a failure rather than trusting its old count', async () => {
      await service.refresh()
      getOpenPayoutsCount.mockRejectedValueOnce(new Error('ECONNRESET'))
      await service.refresh()
      await service.refresh()

      expect(getNewPayouts).toHaveBeenCalledTimes(2)
    })

    /**
     * The fast path above skips the *table*, not the tick.
     *
     * An unmoved count is the panel saying the book is unchanged, so the
     * snapshot is still true and its life is renewed. When it was not, a book
     * whose count sat still — the quiet night the fast path exists for — expired
     * underneath the screen, and every user on the amounts list watched it empty
     * out until the next tick noticed and refetched. Every two minutes.
     */
    it('keeps the snapshot alive across ticks that only read the count', async () => {
      await service.refresh()

      // Three ticks' worth of quiet: inside the window a count may be trusted
      // for, and none of it spent out of touch with the panel.
      for (let gap = 0; gap < 3; gap++) await tick()

      expect(getNewPayouts).toHaveBeenCalledTimes(1)
      await expect(offeredAmounts()).resolves.toEqual([60_000])
      await expect(bookAvailable()).resolves.toBe(true)
    })

    /**
     * The count is a good enough answer for the offer and not for the
     * announcements: one payout taken and one added between two ticks leaves it
     * identical, so an unbroken run of equal counts must not mean an unbroken
     * run of never looking.
     */
    it('re-reads the table anyway once the count has been trusted long enough', async () => {
      await service.refresh()

      for (let gap = 0; gap < 7; gap++) await tick()

      expect(getNewPayouts).toHaveBeenCalledTimes(2)
      await expect(bookAvailable()).resolves.toBe(true)
    })

    /** …and the window still means what it says when the panel goes away. */
    it('withdraws the offer once the panel has been unreachable for the window', async () => {
      await service.refresh()
      getOpenPayoutsCount.mockRejectedValue(new Error('ECONNRESET'))

      for (let gap = 0; gap < 7; gap++) await tick()

      await expect(offeredAmounts()).resolves.toEqual([])
      await expect(bookAvailable()).resolves.toBe(false)
    })

    it('offers nothing, and says the book is not fresh, before any refresh', async () => {
      await expect(offeredAmounts()).resolves.toEqual([])
      await expect(bookAvailable()).resolves.toBe(false)
    })

  /**
   * What anybody waiting on a sum is told about is the *difference* between two
   * snapshots — never the book itself. A sum that sits in it for an hour is one
   * arrival, not a hundred and eighty.
   */
  describe('announcing what arrived', () => {
    it('says nothing on the first refresh, having nothing to compare against', async () => {
      await service.refresh()

      expect(announce).not.toHaveBeenCalled()
    })

    it('announces only the amounts that were not there before', async () => {
      await service.refresh()

      getOpenPayoutsCount.mockResolvedValue(4)
      getNewPayouts.mockResolvedValue({
        rows: [panelPayoutRow({ id: 1 }), panelPayoutRow({ id: 2, amount: '1500.00' })],
        unreadable: 0
      })
      await tick()

      expect(announce).toHaveBeenCalledWith([150_000])
    })

    it('announces nothing when the book changed without gaining an amount', async () => {
      await service.refresh()

      getOpenPayoutsCount.mockResolvedValue(2)
      await tick()

      expect(announce).toHaveBeenCalledWith([])
    })

    /**
     * A table read in part is not a smaller book. Writing it as the baseline
     * costs twice: the offer loses amounts that are still there, and the next
     * clean tick announces every one of them as a fresh arrival.
     */
    it('announces nothing, and keeps the offer, when rows could not be read', async () => {
      await service.refresh()

      getOpenPayoutsCount.mockResolvedValue(4)
      getNewPayouts.mockResolvedValue({ rows: [], unreadable: 3 })
      await tick()

      expect(announce).not.toHaveBeenCalled()
      await expect(offeredAmounts()).resolves.toEqual([60_000])
    })

    /** …and the half-read table must not become the baseline for the next diff. */
    it('does not treat the book as new once the table reads cleanly again', async () => {
      await service.refresh()

      getOpenPayoutsCount.mockResolvedValue(4)
      getNewPayouts.mockResolvedValue({ rows: [], unreadable: 3 })
      await tick()

      getNewPayouts.mockResolvedValue({ rows: [panelPayoutRow()], unreadable: 0 })
      await tick()

      expect(announce).toHaveBeenCalledWith([])
    })

    /**
     * Nest's scheduler does not skip an overlapping run, and a panel call walks
     * up to three proxy addresses. Two runs both read the baseline before
     * either writes it, so both see the same arrivals — one sum, two messages.
     */
    it('skips a tick that starts while the previous one is still running', async () => {
      await service.refresh()

      let release = (): void => undefined
      getOpenPayoutsCount.mockReturnValue(new Promise<number>((resolve) => {
        release = () => resolve(4)
      }))

      const slow = service.refresh()
      await service.refresh()

      release()
      await slow

      // Two calls for the two completed ticks; the overlapping one never asked.
      expect(getOpenPayoutsCount).toHaveBeenCalledTimes(2)
    })

    /**
     * A value that is not a list of numbers is no baseline at all. Reading it
     * as an empty offer would tell every watcher the book had just gained
     * everything in it.
     */
    it.each([['not json', 'nonsense'], ['not a list', '{"a":1}'], ['a list with a stray', '[1,"x"]']])(
      'treats a snapshot that is %s as absent rather than empty',
      async (_case: string, stored: string) => {
        await service.refresh()
        redis.store.set('tma:fiat_book:amounts', { value: stored, expiresIn: 120 })

        getOpenPayoutsCount.mockResolvedValue(4)
        await tick()

        expect(announce).not.toHaveBeenCalled()
      }
    )

    /** A snapshot that expired is not an empty book, and must not read as one. */
    it('says nothing after the snapshot expired, rather than re-announcing the book', async () => {
      await service.refresh()
      redis.elapse(200)
      jest.setSystemTime(Date.now() + 200_000)
      getOpenPayoutsCount.mockResolvedValue(4)

      await service.refresh()

      expect(announce).not.toHaveBeenCalled()
    })
  })
  })

  describe('the candidates', () => {
    /**
     * Read live, never from the snapshot: twenty seconds is several lifetimes
     * for a row in this book, and assigning a stale one reaches a stranger's
     * money.
     */
    it('come from a fresh read of the book', async () => {
      await service.refresh()
      await service.findCandidates(60_000)

      expect(getNewPayouts).toHaveBeenCalledTimes(2)
    })

    it('are the payouts carrying exactly that amount', async () => {
      getNewPayouts.mockResolvedValue({
        rows: [panelPayoutRow({ id: 1, amount: '600.00' }), panelPayoutRow({ id: 2, amount: '601.00' })],
        unreadable: 0
      })

      const candidates = await service.findCandidates(60_000)

      expect(candidates.map(({ id }) => id)).toEqual([1])
    })

    /** Oldest first: the least contended row, and the one Transacto wants gone. */
    it('are ordered oldest first', async () => {
      getNewPayouts.mockResolvedValue({
        rows: [
          panelPayoutRow({ id: 1, created_at: '2026-09-03 12:30:33' }),
          panelPayoutRow({ id: 2, created_at: '2026-09-03 11:05:00' })
        ],
        unreadable: 0
      })

      const candidates = await service.findCandidates(60_000)

      expect(candidates.map(({ id }) => id)).toEqual([2, 1])
    })

    /**
     * Covers the assignment that succeeded upstream while the answer never
     * reached us: the payout is ours, still looks open, and must not be handed
     * to a second person.
     */
    it('exclude a payout this system already holds', async () => {
      findHeldPayoutIds.mockResolvedValue([100_990])

      await expect(service.findCandidates(60_000)).resolves.toEqual([])
    })
  })
})
