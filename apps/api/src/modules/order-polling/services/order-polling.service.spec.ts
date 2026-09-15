import { Logger } from '@nestjs/common'
import { OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db'
import { OrderPollingService } from './order-polling.service'

const ORDER_ID = 1810220
const CARD_ID = 29042
const TERMINAL_ID = 28558
const TRADER = { traderId: 592, apiToken: 'token' }

/**
 * **What an operator's manual confirmation has to do about the money.**
 *
 * A `order.paid` webhook means Transacto considers the order settled — in
 * practice an operator pressing the button because the jar page was slow and
 * the deadline was close. Removing the order from the pending pool is the
 * obvious half. The half that was missing is that its hryvnia are sitting in
 * the jar unaccounted for, and the next reading offers them to whatever orders
 * are pending by then.
 *
 * That is not hypothetical. On 2026-09-08 two orders were confirmed this way,
 * their 611 UAH stayed outside the baseline, the jar page caught up with a
 * single 919 UAH jump, and fuzzy matching spent the same money again on two
 * different orders — releasing 606 UAH of a user's USDT for payments nobody
 * made.
 */
describe('OrderPollingService — an order paid from the panel', () => {
  let trackedOrderDbService: { findByOrderId: jest.Mock; markCompleted: jest.Mock }
  let terminalDbService: { findOne: jest.Mock }
  let terminalStateCacheService: { advanceBaseline: jest.Mock }
  let service: OrderPollingService

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    trackedOrderDbService = {
      findByOrderId: jest.fn(async () => ({ orderId: ORDER_ID, cardId: CARD_ID, amount: 30500 })),
      markCompleted: jest.fn(async () => true)
    }
    terminalDbService = { findOne: jest.fn(async () => ({ terminalId: TERMINAL_ID })) }
    terminalStateCacheService = { advanceBaseline: jest.fn(async () => 126500) }

    service = new OrderPollingService(
      terminalDbService as never,
      trackedOrderDbService as never,
      {} as never,
      terminalStateCacheService as never,
      {} as never,
      {} as never
    )
  })

  afterEach(() => jest.restoreAllMocks())

  const paid = () =>
    service.handleOrderPaid(TRADER as never, { id: ORDER_ID, amount: 305 } as never)

  it('settles the order as an admin-panel execution', async () => {
    await paid()

    expect(trackedOrderDbService.markCompleted).toHaveBeenCalledWith(
      ORDER_ID,
      OrderStatus.EXECUTED,
      OrderExecutionReason.ADMIN_PANEL
    )
  })

  it('accounts for its money by advancing the jar baseline', async () => {
    await paid()

    expect(terminalStateCacheService.advanceBaseline).toHaveBeenCalledWith(TERMINAL_ID, 30500)
  })

  /**
   * The kopecks we tracked, never the webhook's `amount`. Theirs is in hryvnia
   * and every other figure in this ledger is not; advancing by 305 instead of
   * 30500 would leave the same phantom, a hundred times smaller.
   */
  it('advances by the tracked kopecks and not the webhook hryvnia', async () => {
    await paid()

    const [, advancedBy] = terminalStateCacheService.advanceBaseline.mock.calls[0]

    expect(advancedBy).toBe(30500)
  })

  /**
   * The matcher sets the baseline to the balance it actually read. Adding this
   * order's amount on top would account for the same money twice — the mistake
   * this fix exists to prevent, made from the other direction.
   */
  it('leaves the baseline alone when the matcher settled the order first', async () => {
    trackedOrderDbService.markCompleted.mockResolvedValue(false)

    await paid()

    expect(terminalStateCacheService.advanceBaseline).not.toHaveBeenCalled()
  })

  describe('when the money cannot be attributed', () => {
    /** Every one of these is a log line, never a throw: the order is already
     * settled, and a non-2xx would have Transacto redeliver and settle again. */
    it('does not throw when the order was never tracked here', async () => {
      trackedOrderDbService.findByOrderId.mockResolvedValue(null)

      await expect(paid()).resolves.toBeUndefined()
      expect(terminalStateCacheService.advanceBaseline).not.toHaveBeenCalled()
    })

    it('does not throw when the card belongs to no terminal', async () => {
      terminalDbService.findOne.mockResolvedValue(null)

      await expect(paid()).resolves.toBeUndefined()
      expect(terminalStateCacheService.advanceBaseline).not.toHaveBeenCalled()
    })

    /** No baseline means no scrape loop, so there is no delta to double-spend. */
    it('does not throw when the terminal has no baseline yet', async () => {
      terminalStateCacheService.advanceBaseline.mockResolvedValue(null)

      await expect(paid()).resolves.toBeUndefined()
    })
  })
})

/**
 * **Most `order.paid` deliveries are this process hearing itself.**
 *
 * Transacto fires the webhook the instant `orders_execute` succeeds, so an
 * order the matcher just executed comes straight back — measured at under a
 * second, and often before the matcher has finished writing its own reason.
 * Read as a manual confirmation it did two things wrong: every automatic match
 * was recorded as `ADMIN_PANEL` and shown to users as "confirmed manually", and
 * the baseline was advanced for money that had not arrived yet, pushing the
 * expected balance above the real one.
 */
describe('OrderPollingService — Transacto echoing our own execution', () => {
  let trackedOrderDbService: { findByOrderId: jest.Mock; markCompleted: jest.Mock }
  let terminalStateCacheService: { advanceBaseline: jest.Mock }
  let service: OrderPollingService

  const paidAfter = (agoMs: number) => {
    trackedOrderDbService.findByOrderId.mockResolvedValue({
      orderId: ORDER_ID,
      cardId: CARD_ID,
      amount: 30500,
      executionStartedAt: new Date(Date.now() - agoMs)
    })

    return service.handleOrderPaid(TRADER as never, { id: ORDER_ID, amount: 305 } as never)
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    trackedOrderDbService = { findByOrderId: jest.fn(), markCompleted: jest.fn(async () => true) }
    terminalStateCacheService = { advanceBaseline: jest.fn(async () => 126500) }

    service = new OrderPollingService(
      { findOne: jest.fn(async () => ({ terminalId: TERMINAL_ID })) } as never,
      trackedOrderDbService as never,
      {} as never,
      terminalStateCacheService as never,
      {} as never,
      {} as never
    )
  })

  afterEach(() => jest.restoreAllMocks())

  it('leaves the order to the path that executed it', async () => {
    await paidAfter(900)

    expect(trackedOrderDbService.markCompleted).not.toHaveBeenCalled()
  })

  /**
   * The matcher sets the baseline from the balance it actually read. Advancing
   * it here as well accounts for money that may not have landed yet — which is
   * how an expected balance ran ₴1 052 ahead of a real one.
   */
  it('does not advance the baseline for money that may not have arrived', async () => {
    await paidAfter(900)

    expect(terminalStateCacheService.advanceBaseline).not.toHaveBeenCalled()
  })

  /**
   * The marker is durable and the echo is not. An order this process tried to
   * execute and failed keeps it, and an operator confirming that same order
   * later is a genuine manual confirmation which must still be accounted for.
   */
  it('treats a stale marker as a real manual confirmation', async () => {
    await paidAfter(10 * 60 * 1000)

    expect(trackedOrderDbService.markCompleted).toHaveBeenCalled()
    expect(terminalStateCacheService.advanceBaseline).toHaveBeenCalledWith(TERMINAL_ID, 30500)
  })

  /** An order settled entirely upstream never carried a marker at all. */
  it('treats an unmarked order as a real manual confirmation', async () => {
    trackedOrderDbService.findByOrderId.mockResolvedValue({
      orderId: ORDER_ID,
      cardId: CARD_ID,
      amount: 30500
    })

    await service.handleOrderPaid(TRADER as never, { id: ORDER_ID, amount: 305 } as never)

    expect(trackedOrderDbService.markCompleted).toHaveBeenCalled()
  })
})
