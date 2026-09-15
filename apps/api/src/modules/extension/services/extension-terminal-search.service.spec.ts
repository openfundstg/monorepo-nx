import { SaleRemainderPolicy, TerminalSource } from '@transacto/contracts'
import { ExtensionTerminalSearchService } from './extension-terminal-search.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { OrderDbService } from 'src/modules/repositories/order-db/services'
import type { TerminalStateCacheService } from 'src/modules/bank-scraper'
import type { TerminalUrlResolverService } from 'src/modules/terminal'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TRADER_ID = 592

let nextCardId = 1

const terminal = (over: Record<string, unknown> = {}) => ({
  traderId: TRADER_ID,
  cardId: nextCardId++,
  terminalId: 20_000 + nextCardId,
  terminalName: 'Jar',
  cred3: 'https://send.monobank.ua/jar/abc?sendId=xyz',
  enabled: true,
  source: TerminalSource.TRANSACTO,
  lastBalance: null,
  lastGoal: null,
  lastBalanceAt: null,
  ...over,
})

describe('ExtensionTerminalSearchService', () => {
  let db: { count: jest.Mock; findLimited: jest.Mock }
  let orders: { getPendingOrdersForCards: jest.Mock }
  let cache: { getCurrentState: jest.Mock }
  let sales: { findRemainderPoliciesByCardIds: jest.Mock }
  let service: ExtensionTerminalSearchService

  /** Whatever the broad query returns; the exact-name query returns nothing. */
  const givenStored = (...terminals: unknown[]): void => {
    db.findLimited.mockImplementation((filter: Record<string, unknown>) =>
      Promise.resolve('$or' in filter ? terminals : []),
    )
    db.count.mockResolvedValue(terminals.length)
  }

  beforeEach(() => {
    nextCardId = 1
    db = { count: jest.fn().mockResolvedValue(0), findLimited: jest.fn().mockResolvedValue([]) }
    orders = { getPendingOrdersForCards: jest.fn().mockResolvedValue([]) }
    cache = { getCurrentState: jest.fn().mockResolvedValue(null) }
    sales = { findRemainderPoliciesByCardIds: jest.fn().mockResolvedValue(new Map()) }

    service = new ExtensionTerminalSearchService(
      db as unknown as TerminalDbService,
      orders as unknown as OrderDbService,
      cache as unknown as TerminalStateCacheService,
      { resolve: () => 'https://send.monobank.ua/jar/abc' } as unknown as TerminalUrlResolverService,
      sales as unknown as TmaSaleDbService,
    )
  })

  describe('ranking', () => {
    /** The point of the endpoint: the terminal the trader named comes first. */
    it('puts an exact name match above every partial one', async () => {
      givenStored(
        terminal({ terminalName: 'Прокрутка 12 (резерв)' }),
        terminal({ terminalName: 'Стара прокрутка 12' }),
        terminal({ terminalName: 'Прокрутка 12' }),
      )

      const { terminals } = await service.search(TRADER_ID, 'Прокрутка 12', 20)

      expect(terminals[0].terminalName).toBe('Прокрутка 12')
    })

    it('matches the name exactly regardless of case', async () => {
      givenStored(
        terminal({ terminalName: 'прокрутка abc' }),
        terminal({ terminalName: 'ПРОКРУТКА' }),
      )

      const { terminals } = await service.search(TRADER_ID, 'прокрутка', 20)

      expect(terminals[0].terminalName).toBe('ПРОКРУТКА')
    })

    it('ranks a prefix above a mere substring', async () => {
      givenStored(
        terminal({ terminalName: 'Стара банка 7' }),
        terminal({ terminalName: 'Банка 7 нова' }),
      )

      const { terminals } = await service.search(TRADER_ID, 'банка 7', 20)

      expect(terminals.map((t) => t.terminalName)).toEqual(['Банка 7 нова', 'Стара банка 7'])
    })

    it('ranks a fully typed id above a name that merely contains it', async () => {
      givenStored(
        terminal({ cardId: 900, terminalName: 'Банка 55510' }),
        terminal({ cardId: 5551, terminalName: 'Інша' }),
      )

      const { terminals } = await service.search(TRADER_ID, '5551', 20)

      expect(terminals[0].cardId).toBe(5551)
    })

    /** An ambiguous term is far likelier to mean the jar still running. */
    it('puts a live terminal before a dead one at the same rank', async () => {
      givenStored(
        terminal({ terminalName: 'Банка А', enabled: false }),
        terminal({ terminalName: 'Банка Б', enabled: true }),
      )

      const { terminals } = await service.search(TRADER_ID, 'банка', 20)

      expect(terminals[0].enabled).toBe(true)
    })

    /**
     * The broad query is capped and ordered by recency, so on a large account
     * the very terminal the trader named could be the row the cap dropped.
     */
    it('keeps an exact match that the capped broad query missed', async () => {
      const exact = terminal({ terminalName: 'Прокрутка 12' })
      db.findLimited.mockImplementation((filter: Record<string, unknown>) =>
        Promise.resolve('$or' in filter ? [terminal({ terminalName: 'Прокрутка 120' })] : [exact]),
      )
      db.count.mockResolvedValue(201)

      const { terminals } = await service.search(TRADER_ID, 'Прокрутка 12', 20)

      expect(terminals[0].terminalName).toBe('Прокрутка 12')
    })

    it('does not return the same terminal twice when both queries find it', async () => {
      const shared = terminal({ terminalName: 'Прокрутка 12' })
      db.findLimited.mockResolvedValue([shared])
      db.count.mockResolvedValue(1)

      const { terminals } = await service.search(TRADER_ID, 'Прокрутка 12', 20)

      expect(terminals).toHaveLength(1)
    })
  })

  describe('the query itself', () => {
    it('looks up numeric ids only when the term is entirely digits', async () => {
      await service.search(TRADER_ID, '12ab', 20)

      const [filter] = db.count.mock.calls[0]
      expect(JSON.stringify(filter.$or)).not.toContain('cardId')
    })

    it('looks up ids when it is', async () => {
      await service.search(TRADER_ID, '5551', 20)

      const [filter] = db.count.mock.calls[0]
      expect(filter.$or).toEqual(expect.arrayContaining([{ cardId: 5551 }, { terminalId: 5551 }]))
    })

    /** `$regex` compiles whatever it is given; a term is a literal, not a pattern. */
    it('treats a term full of regex metacharacters as literal text', async () => {
      givenStored(terminal({ terminalName: 'Jar (main)' }))

      const { terminals } = await service.search(TRADER_ID, 'Jar (', 20)

      expect(terminals).toHaveLength(1)
    })
  })

  describe('the figures on each row', () => {
    it('prefers the live Redis state', async () => {
      givenStored(terminal({ lastBalance: 90_000, lastGoal: 100_000 }))
      cache.getCurrentState.mockResolvedValue({ current: 120_000, goal: 235_000 })

      const { terminals } = await service.search(TRADER_ID, 'jar', 20)

      expect(terminals[0]).toMatchObject({ balance: 120_000, goal: 235_000 })
    })

    it('falls back to the persisted copy for a jar nobody is polling', async () => {
      const observedAt = new Date('2026-08-20T10:00:00.000Z')
      givenStored(
        terminal({ enabled: false, lastBalance: 90_000, lastGoal: 100_000, lastBalanceAt: observedAt }),
      )

      const { terminals } = await service.search(TRADER_ID, 'jar', 20)

      expect(terminals[0]).toMatchObject({
        balance: 90_000,
        goal: 100_000,
        balanceAt: observedAt.toISOString(),
        enabled: false,
      })
    })

    /**
     * A terminal disabled before those fields existed has nothing stored. Zero
     * would claim an empty jar, which is a different statement from not knowing.
     */
    it('reports an unknown balance as null rather than zero', async () => {
      givenStored(terminal({ enabled: false }))

      const { terminals } = await service.search(TRADER_ID, 'jar', 20)

      expect(terminals[0].balance).toBeNull()
      expect(terminals[0].goal).toBeNull()
      expect(terminals[0].balanceAt).toBeUndefined()
    })

    it('totals pending orders per card', async () => {
      const first = terminal({ terminalName: 'Jar A' })
      const second = terminal({ terminalName: 'Jar B' })
      givenStored(first, second)
      orders.getPendingOrdersForCards.mockResolvedValue([
        { cardId: first.cardId, amount: 30_000 },
        { cardId: first.cardId, amount: 20_000 },
      ])

      const { terminals } = await service.search(TRADER_ID, 'jar', 20)
      const byName = new Map(terminals.map((t) => [t.terminalName, t]))

      expect(byName.get('Jar A')).toMatchObject({ pendingOrdersSum: 50_000, hasPendingOrders: true })
      expect(byName.get('Jar B')).toMatchObject({ pendingOrdersSum: 0, hasPendingOrders: false })
    })
  })

  it('reports the full match count even when the page is smaller', async () => {
    givenStored(terminal(), terminal(), terminal())
    db.count.mockResolvedValue(57)

    const { terminals, total } = await service.search(TRADER_ID, 'jar', 2)

    expect(terminals).toHaveLength(2)
    expect(total).toBe(57)
  })

  /** The dashboard hides them; this is the only route back to one. */
  it('returns disabled terminals', async () => {
    givenStored(terminal({ enabled: false }))

    const { terminals } = await service.search(TRADER_ID, 'jar', 20)

    expect(terminals).toHaveLength(1)
    expect(terminals[0].enabled).toBe(false)
  })

  /**
   * What the trader is really asking is whether a jar will ever want something
   * from them. It has to survive on a *disabled* terminal too: a completed
   * order's terminal is only reachable through here, and it is still worth
   * knowing what it was for.
   */
  describe('the remainder policy', () => {
    it('rides along on the row', async () => {
      const jar = terminal({ terminalName: 'Прокрутка' })
      givenStored(jar)
      sales.findRemainderPoliciesByCardIds.mockResolvedValue(
        new Map([[jar.cardId, SaleRemainderPolicy.REFUND_TO_BALANCE]]),
      )

      const { terminals } = await service.search(TRADER_ID, 'прокрутка', 20)

      expect(terminals[0].remainderPolicy).toBe(SaleRemainderPolicy.REFUND_TO_BALANCE)
    })

    it('is absent on a terminal with no sale behind it', async () => {
      givenStored(terminal({ terminalName: 'Jar' }))

      const { terminals } = await service.search(TRADER_ID, 'jar', 20)

      expect(terminals[0].remainderPolicy).toBeUndefined()
    })

    /** One query for the page, not one per row. */
    it('is looked up once for the whole page', async () => {
      givenStored(terminal({ terminalName: 'Jar A' }), terminal({ terminalName: 'Jar B' }))

      await service.search(TRADER_ID, 'jar', 20)

      expect(sales.findRemainderPoliciesByCardIds).toHaveBeenCalledTimes(1)
    })
  })
})
