import { SaleBlockReason } from '@transacto/contracts'
import { SaleComplianceService } from './sale-compliance.service'
import { OrderStatus, type OrderDbService } from 'src/modules/repositories/order-db'
import type { SaleBlockService } from './sale-block.service'

const CARD_ID = 100

/** 50 USDT at 40.00 UAH/USDT plus 2% = 2040.00 UAH, in kopecks. */
const FIAT_AMOUNT = 204_000

const storedOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'Z38SL69F',
  telegramId: 885140,
  fiatAmount: FIAT_AMOUNT,
  cardId: CARD_ID,
  receivedAmount: 0,
  frozenUsdt: 5_000,
  ...overrides,
})

const order = (status: OrderStatus) => ({ status })

describe('SaleComplianceService', () => {
  let orders: { findRecentByCard: jest.Mock }
  let blocker: { block: jest.Mock }
  let service: SaleComplianceService

  beforeEach(() => {
    orders = { findRecentByCard: jest.fn().mockResolvedValue([]) }
    blocker = { block: jest.fn().mockResolvedValue(true) }

    service = new SaleComplianceService(
      orders as unknown as OrderDbService,
      blocker as unknown as SaleBlockService,
    )
  })

  /**
   * The operator has looked at the order and put it back to work. Raising the
   * same block on the next scrape would make the panel's button a no-op — which
   * is what it was: a resumed order came back blocked seventeen seconds later
   * over the same four hryvnia.
   */
  describe('an order an operator has resumed', () => {
    const resumed = () => storedOrder({ resumedByAdminAt: new Date() })

    it('is not blocked for a target that does not match', async () => {
      const blocked = await service.check(resumed() as never, 100_000, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /**
     * The other rule stays on. It is about a card that does not belong to the
     * jar, and nobody can vouch for that by pressing a button.
     */
    it('is still blocked by a streak of dead orders', async () => {
      orders.findRecentByCard.mockResolvedValue([
        order(OrderStatus.CANCELLED),
        order(OrderStatus.CANCELLED),
        order(OrderStatus.CANCELLED),
      ])

      const blocked = await service.check(resumed() as never, FIAT_AMOUNT, 0)

      expect(blocked).toBe(true)
      expect(blocker.block).toHaveBeenCalledWith(
        expect.anything(),
        SaleBlockReason.ORDERS_EXPIRED,
      )
    })
  })

  describe('the jar target', () => {
    it('passes when it matches the order total exactly', async () => {
      const blocked = await service.check(storedOrder() as never, FIAT_AMOUNT, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /**
     * One hryvnia either way is the person, not an abuse: they are told ₴2 349
     * and they set ₴2 350, because that is what a human does with a number.
     * Blocking that costs them a frozen stake and gains nothing.
     *
     * `floorToWholeUah` made this more common rather than less — the order's
     * target is now rounded *down* from the exact conversion, so a user
     * rounding their own figure up is a hryvnia out far more often.
     */
    it.each([
      ['under by a hryvnia', FIAT_AMOUNT - 100],
      ['over by a hryvnia', FIAT_AMOUNT + 100],
    ])('passes when it is %s', async (_label, goal) => {
      const blocked = await service.check(storedOrder() as never, goal, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /**
     * The allowance scales with the order: one percent of ₴2 040 is ₴20.40, so
     * a few hryvnia either way is a rounding rather than a different jar.
     *
     * This is what a flat hryvnia got wrong at the top of the range — NovaPay
     * reporting a goal four hryvnia above a ₴6 642 order blocked it twice, over
     * six hundredths of a percent.
     */
    it.each([
      ['under by two hryvnia', FIAT_AMOUNT - 200],
      ['over by two hryvnia', FIAT_AMOUNT + 200],
      ['just inside one percent', FIAT_AMOUNT + 2_000],
    ])('passes when it is %s', async (_label, goal) => {
      const blocked = await service.check(storedOrder() as never, goal, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** Past one percent the jar stops looking like the same jar. */
    it.each([
      ['under by more than one percent', FIAT_AMOUNT - 2_200],
      ['over by more than one percent', FIAT_AMOUNT + 2_200],
      ['a round number the user typed instead', 200_000],
    ])('blocks when it is %s', async (_label, goal) => {
      const blocked = await service.check(storedOrder() as never, goal, 0)

      expect(blocked).toBe(true)
      expect(blocker.block).toHaveBeenCalledWith(
        expect.anything(),
        SaleBlockReason.GOAL_MISMATCH,
        goal,
      )
    })

    /**
     * The whole reason the comparison is in hryvnia. A user who set their jar
     * to exactly the figure we showed them must never be blocked because their
     * bank reported its own rounding a kopeck out — they did everything right.
     */
    it.each([
      ['a kopeck under', FIAT_AMOUNT - 1],
      ['a kopeck over', FIAT_AMOUNT + 1],
      ['tens of kopecks out', FIAT_AMOUNT + 8],
    ])('tolerates a jar reported %s', async (_label, goal) => {
      const blocked = await service.check(storedOrder() as never, goal, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /**
     * A scrape that omits the goal says nothing about the jar — the balance
     * contract documents the field as optional. Reading absence as "no goal
     * set" blocked live orders on a single unlucky reading.
     */
    it('does not block when the scrape reported no target', async () => {
      const blocked = await service.check(storedOrder() as never, undefined, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** Checked first: a wrong target is the user's to fix, and says so. */
    it('takes precedence over the expired-orders rule', async () => {
      orders.findRecentByCard.mockResolvedValue([
        order(OrderStatus.CANCELLED),
        order(OrderStatus.CANCELLED),
        order(OrderStatus.CANCELLED),
      ])

      await service.check(storedOrder() as never, 1, 0)

      expect(blocker.block).toHaveBeenCalledTimes(1)
      expect(blocker.block).toHaveBeenCalledWith(
        expect.anything(),
        SaleBlockReason.GOAL_MISMATCH,
        1,
      )
    })
  })

  /**
   * The reported case, with its real figures: the jar was set to ₴2 350 while
   * the order was for ₴2 349, and the order was blocked with the stake frozen.
   */
  describe('the reported one-hryvnia block', () => {
    const ORDER_TOTAL = 234_900
    const JAR_TARGET = 235_000

    it('no longer blocks a jar set a hryvnia high', async () => {
      const blocked = await service.check(
        storedOrder({ fiatAmount: ORDER_TOTAL }) as never,
        JAR_TARGET,
        0,
      )

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })
  })

  describe('once money is in flight', () => {
    /**
     * The production incident this guards against: 87 UAH landed in the jar,
     * the next scrape found a mismatched target, and the order was blocked —
     * stranding the payer's hryvnia in the jar *and* the user's frozen USDT,
     * with no path to either.
     *
     * A jar whose target is wrong simply never fills; the order expires on its
     * own terms. That is a far better outcome than freezing two sets of funds.
     */
    it('never blocks for a mismatched target once the jar holds money', async () => {
      const blocked = await service.check(storedOrder() as never, 100_000, 8_700)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    it('never blocks once a payment has already been credited', async () => {
      const withPayment = storedOrder({ receivedAmount: 8_700 })

      const blocked = await service.check(withPayment as never, 100_000, 0)

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** Still enforced on a terminal that has never seen a hryvnia. */
    it('still blocks a mismatched target while the jar is empty', async () => {
      const blocked = await service.check(storedOrder() as never, 100_000, 0)

      expect(blocked).toBe(true)
      expect(blocker.block).toHaveBeenCalledWith(
        expect.anything(),
        SaleBlockReason.GOAL_MISMATCH,
        100_000,
      )
    })
  })

  describe('orders that go nowhere', () => {
    const cancelledStreak = [
      order(OrderStatus.CANCELLED),
      order(OrderStatus.CANCELLED),
      order(OrderStatus.CANCELLED),
    ]

    it('blocks after three in a row on an empty jar', async () => {
      orders.findRecentByCard.mockResolvedValue(cancelledStreak)

      const blocked = await service.check(storedOrder() as never, FIAT_AMOUNT, 0)

      expect(blocked).toBe(true)
      expect(blocker.block).toHaveBeenCalledWith(
        expect.anything(),
        SaleBlockReason.ORDERS_EXPIRED,
      )
      expect(orders.findRecentByCard).toHaveBeenCalledWith(CARD_ID, 3)
    })

    /**
     * The rule catches one thing: a card that does not belong to the jar the
     * link points at. PrivatBank names the card in its own envelope record, so
     * for those orders that cannot be what happened — a streak of dead orders
     * is payers walking away, and blocking would freeze a correctly set-up
     * user's stake for something nobody did wrong.
     */
    it('never blocks an order whose card came from the bank', async () => {
      orders.findRecentByCard.mockResolvedValue(cancelledStreak)

      const blocked = await service.check(
        storedOrder({ cardVerifiedByBank: true }) as never,
        FIAT_AMOUNT,
        0,
      )

      expect(blocked).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** Not even looked up — there is nothing the answer could change. */
    it('does not even read the order history for one', async () => {
      await service.check(storedOrder({ cardVerifiedByBank: true }) as never, FIAT_AMOUNT, 0)

      expect(orders.findRecentByCard).not.toHaveBeenCalled()
    })

    /**
     * Orders written before the field existed default to `false`, so they keep
     * the rule. That is the safe direction: an unnecessary check costs a false
     * positive on a jar nobody could pay into anyway.
     */
    it('still blocks an order that never recorded the fact', async () => {
      orders.findRecentByCard.mockResolvedValue(cancelledStreak)

      expect(await service.check(storedOrder() as never, FIAT_AMOUNT, 0)).toBe(true)
    })

    it('tolerates two', async () => {
      orders.findRecentByCard.mockResolvedValue([
        order(OrderStatus.CANCELLED),
        order(OrderStatus.CANCELLED),
      ])

      expect(await service.check(storedOrder() as never, FIAT_AMOUNT, 0)).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** "In a row" — the streak is broken by anything that is not cancelled. */
    it('does not block when the run is interrupted', async () => {
      orders.findRecentByCard.mockResolvedValue([
        order(OrderStatus.CANCELLED),
        order(OrderStatus.PENDING),
        order(OrderStatus.CANCELLED),
      ])

      expect(await service.check(storedOrder() as never, FIAT_AMOUNT, 0)).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /**
     * Both halves are required. Money in the jar proves the wiring works, so a
     * run of failures is the payers' doing, not the setup's.
     */
    it('does not block while the jar holds money', async () => {
      orders.findRecentByCard.mockResolvedValue(cancelledStreak)

      expect(await service.check(storedOrder() as never, FIAT_AMOUNT, 50_000)).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    /** Nor if it ever did, even though it reads empty now. */
    it('does not block a terminal that has already received money', async () => {
      orders.findRecentByCard.mockResolvedValue(cancelledStreak)

      const withHistory = storedOrder({ receivedAmount: 204_000 })

      expect(await service.check(withHistory as never, FIAT_AMOUNT, 0)).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    it('does nothing before three orders exist at all', async () => {
      orders.findRecentByCard.mockResolvedValue([order(OrderStatus.CANCELLED)])

      expect(await service.check(storedOrder() as never, FIAT_AMOUNT, 0)).toBe(false)
      expect(blocker.block).not.toHaveBeenCalled()
    })

    it('skips the query entirely for an order with no terminal yet', async () => {
      const unlinked = storedOrder({ cardId: null })

      expect(await service.check(unlinked as never, FIAT_AMOUNT, 0)).toBe(false)
      expect(orders.findRecentByCard).not.toHaveBeenCalled()
    })
  })
})
