import { SaleCardOrderState } from '@transacto/contracts'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TMA_CARD_SALE_ROUTING_CUTOFF_MS } from 'src/shared/constants'
import { SaleCardWatchService } from './sale-card-watch.service'
import type { SaleCardOrderService } from './sale-card-order.service'

const NOW = new Date('2026-09-18T18:00:00.000Z')

/** One card order, placed relative to now by how long it has left. */
const order = (msLeft: number, state = SaleCardOrderState.AWAITING_CONFIRMATION) => ({
  orderId: 1234567,
  amount: 142_800,
  state,
  confirmDeadlineAt: new Date(NOW.getTime() + msLeft),
})

const sale = (...cardOrders: ReturnType<typeof order>[]) => ({
  _id: { toString: () => 'sale-1' },
  publicId: 'Z38SL69F',
  cardOrders,
})

describe('SaleCardWatchService', () => {
  let sales: { findCardOrdersDueBy: jest.Mock }
  let cardOrders: { expire: jest.Mock; holdRouting: jest.Mock }
  let service: SaleCardWatchService

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW)

    sales = { findCardOrdersDueBy: jest.fn().mockResolvedValue([]) }
    cardOrders = {
      expire: jest.fn().mockResolvedValue(null),
      holdRouting: jest.fn().mockResolvedValue(undefined),
    }

    service = new SaleCardWatchService(
      sales as unknown as TmaSaleDbService,
      cardOrders as unknown as SaleCardOrderService,
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /**
   * The query has to reach past now, or the early stop can never be reached:
   * an order still inside its window would not be in the result at all.
   */
  it('asks for orders due within the cutoff, not merely overdue ones', async () => {
    await service.disputeUnansweredOrders()

    expect(sales.findCardOrdersDueBy).toHaveBeenCalledWith(
      new Date(NOW.getTime() + TMA_CARD_SALE_ROUTING_CUTOFF_MS),
    )
  })

  /**
   * **The race this exists to close.** Expiry and routing are both Transacto's
   * decisions on Transacto's clock, so a credential freed by one order running
   * out can be given another in the same second — before any sweep has seen the
   * first expire. Two unanswered orders on one sale makes "did the ₴1 428
   * arrive?" unanswerable, which is the one thing the card variant cannot have.
   */
  it('shuts the terminal for an order that is close to its deadline', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([sale(order(10_000))])

    await service.disputeUnansweredOrders()

    expect(cardOrders.holdRouting).toHaveBeenCalledTimes(1)
    expect(cardOrders.expire).not.toHaveBeenCalled()
  })

  /** The seller still has their window: the order itself is left alone. */
  it('does not dispute an order that still has time left', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([sale(order(1))])

    await service.disputeUnansweredOrders()

    expect(cardOrders.expire).not.toHaveBeenCalled()
  })

  it('disputes an order once its deadline has passed', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([sale(order(-1))])

    await service.disputeUnansweredOrders()

    expect(cardOrders.expire).toHaveBeenCalledTimes(1)
  })

  /** A dispute stops routing by itself, so both would be the same call twice. */
  it('does not also hold routing when something is already overdue', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([sale(order(-1))])

    await service.disputeUnansweredOrders()

    expect(cardOrders.holdRouting).not.toHaveBeenCalled()
  })

  /** An order already answered is not a reason to shut anything. */
  it('leaves a sale alone when its only near order is already settled', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([
      sale(order(10_000, SaleCardOrderState.CONFIRMED)),
    ])

    await service.disputeUnansweredOrders()

    expect(cardOrders.holdRouting).not.toHaveBeenCalled()
    expect(cardOrders.expire).not.toHaveBeenCalled()
  })

  /** One sale's failure must not strand every other one behind it. */
  it('carries on after one sale fails', async () => {
    sales.findCardOrdersDueBy.mockResolvedValue([sale(order(-1)), sale(order(-1))])
    cardOrders.expire.mockRejectedValueOnce(new Error('transacto is down'))

    await expect(service.disputeUnansweredOrders()).resolves.toBeUndefined()

    expect(cardOrders.expire).toHaveBeenCalledTimes(2)
  })

  it('survives the sweep query itself failing', async () => {
    sales.findCardOrdersDueBy.mockRejectedValue(new Error('mongo is down'))

    await expect(service.disputeUnansweredOrders()).resolves.toBeUndefined()
  })
})
