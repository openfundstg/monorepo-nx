import { RepriceOrdersAtSellRateMigration } from './0003-reprice-orders-at-sell-rate.migration'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

/** The production order the rewrite was verified against. */
const order = (overrides: Record<string, unknown> = {}) => ({
  _id: 'order-1',
  publicId: '8GJPNPDY',
  fiatAmount: 664_200,
  frozenUsdt: 14_253,
  ...overrides
})

describe('0003-reprice-orders-at-sell-rate', () => {
  let sales: { findPricedAtMarketRate: jest.Mock; repriceToSellRate: jest.Mock }
  let migration: RepriceOrdersAtSellRateMigration

  /** Pages of unconverted orders, then an empty one — as `findPage` walks. */
  const pages = (...batches: unknown[][]) => {
    const answer = jest.fn()
    for (const items of batches) answer.mockResolvedValueOnce({ items, total: items.length })
    answer.mockResolvedValue({ items: [], total: 0 })

    return answer
  }

  beforeEach(() => {
    sales = {
      findPricedAtMarketRate: pages([]),
      repriceToSellRate: jest.fn().mockResolvedValue(true)
    }

    migration = new RepriceOrdersAtSellRateMigration(
      sales as unknown as TmaSaleDbService
    )
  })

  /**
   * The stake is the target at the rate it sold at, so the rate is the target
   * divided by the stake. ₴6 642 for 142.53 USDT is ₴46.60 — which is
   * `sellRate(4568)` to the kopeck, the figure the order was actually created
   * with.
   */
  it('recovers the rate from the target and the stake', async () => {
    sales.findPricedAtMarketRate = pages([order()])

    await expect(migration.up()).resolves.toContain('1 order')
    expect(sales.repriceToSellRate).toHaveBeenCalledWith('order-1', 4_660)
  })

  /**
   * **The regression that matters.** The first version of this file multiplied
   * the *stored* rate by the stored markup. `strict: true` then silently
   * dropped the `$unset` that was supposed to take the document out of the
   * result set, so it was read and marked up again — eleven thousand times,
   * until every rate on production read 1e97.
   *
   * Deriving from the stake is immune to that by construction: the stored rate
   * is not an input, so a document already ruined by the loop converts to the
   * same answer as an untouched one.
   */
  it('ignores the stored rate entirely, however wrong it is', async () => {
    sales.findPricedAtMarketRate = pages([
      order({ exchangeRate: 1.0143093894706378e97, profitPercent: 2 })
    ])

    await migration.up()

    expect(sales.repriceToSellRate).toHaveBeenCalledWith('order-1', 4_660)
  })

  /**
   * The structural half of the fix. Everything is gathered before anything is
   * written, so the walk is over a fixed list — a write that fails to remove
   * its document cannot feed it back in.
   */
  it('reads the collection once and never re-reads it', async () => {
    sales.findPricedAtMarketRate = pages([order(), order({ _id: 'order-2' })])

    await expect(migration.up()).resolves.toContain('2 order')
    // One page, then the empty read that ends the walk. Never a third.
    expect(sales.findPricedAtMarketRate).toHaveBeenCalledTimes(1)
  })

  /** And a write that changed nothing does not put the document back in play. */
  it('terminates even when no write takes effect', async () => {
    sales.findPricedAtMarketRate = pages([order()])
    sales.repriceToSellRate.mockResolvedValue(false)

    await expect(migration.up()).resolves.toContain('repriced 0 order')
    expect(sales.repriceToSellRate).toHaveBeenCalledTimes(1)
  })

  /**
   * An order that failed before anything was frozen has no stake to divide by,
   * and needs no rate. Left alone and named rather than converted at a guess.
   */
  it.each([
    ['no stake', { frozenUsdt: 0 }],
    ['no target', { fiatAmount: 0 }]
  ])('leaves an order with %s alone and says so', async (_label, broken) => {
    sales.findPricedAtMarketRate = pages([order(broken)])

    await expect(migration.up()).resolves.toContain('1 left alone')
    expect(sales.repriceToSellRate).not.toHaveBeenCalled()
  })

  /** Nothing to do is a clean pass — which is what a second run reports. */
  it('reports nothing on an already-converted collection', async () => {
    await expect(migration.up()).resolves.toBe('repriced 0 order(s) at their own sell rate')
    expect(sales.repriceToSellRate).not.toHaveBeenCalled()
  })
})
