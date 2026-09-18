import { SaleMethod } from '@transacto/contracts'
import { SaleClosingService } from './sale-closing.service'
import { OrderStatus, type OrderDbService } from 'src/modules/repositories/order-db'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { SaleCancelService } from './sale-cancel.service'

const CARD_ID = 100

const closingOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'Z38SL69F',
  telegramId: 885140,
  cardId: CARD_ID,
  // The jar has been shut, which is the second of the two conditions.
  jarClosedAt: new Date(),
  ...overrides,
})

const pending = () => ({ status: OrderStatus.PENDING })

describe('SaleClosingService', () => {
  let sales: { findClosing: jest.Mock }
  let orders: { findUnsettledByCard: jest.Mock }
  let cancel: { settle: jest.Mock }
  let service: SaleClosingService

  beforeEach(() => {
    sales = { findClosing: jest.fn().mockResolvedValue([closingOrder()]) }
    orders = { findUnsettledByCard: jest.fn().mockResolvedValue([]) }
    cancel = { settle: jest.fn().mockResolvedValue(undefined) }

    service = new SaleClosingService(
      sales as unknown as TmaSaleDbService,
      orders as unknown as OrderDbService,
      cancel as unknown as SaleCancelService,
    )
  })

  it('settles an order once nothing is outstanding', async () => {
    await service.settleFinishedClosings()

    expect(cancel.settle).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'Z38SL69F' }))
  })

  /**
   * The whole reason winding down exists: a payer holding one of these can
   * still pay, and settling now would refund a stake the jar is about to eat.
   */
  it.each([OrderStatus.PENDING, OrderStatus.PAUSED, OrderStatus.APPEAL])(
    'keeps waiting while an order is %s',
    async (status) => {
      orders.findUnsettledByCard.mockResolvedValue([{ status }])

      await service.settleFinishedClosings()

      expect(cancel.settle).not.toHaveBeenCalled()
    },
  )

  /**
   * The second condition, and the reason the user is made to close the jar at
   * all. An order expires on Transacto's clock while its jar stays open, and a
   * payer who started late lands hryvnia in it minutes afterwards — money
   * nothing matches, which comes back as an appeal we are out of pocket on.
   * Releasing the stake before the jar is shut would pay for that twice.
   */
  it('keeps waiting while the jar is still open', async () => {
    sales.findClosing.mockResolvedValue([closingOrder({ jarClosedAt: null })])

    await service.settleFinishedClosings()

    expect(cancel.settle).not.toHaveBeenCalled()
  })

  it('settles once the jar is closed and nothing is outstanding', async () => {
    sales.findClosing.mockResolvedValue([closingOrder({ jarClosedAt: new Date() })])

    await service.settleFinishedClosings()

    expect(cancel.settle).toHaveBeenCalled()
  })

  /** Both conditions, not either: an open order still blocks a closed jar. */
  it('keeps waiting on an outstanding order even with the jar closed', async () => {
    orders.findUnsettledByCard.mockResolvedValue([pending()])
    sales.findClosing.mockResolvedValue([closingOrder({ jarClosedAt: new Date() })])

    await service.settleFinishedClosings()

    expect(cancel.settle).not.toHaveBeenCalled()
  })

  /**
   * **A card sale has no jar, and waiting for one to close is waiting for ever.**
   *
   * The bug this pins: `cardId !== null` was read as "has a jar", and every
   * card sale has a `cardId` — the Transacto credential that routes a payer to
   * the seller's card. So a card sale stopped early sat in `CLOSING` on every
   * pass of this sweep, the stake stayed frozen, and the slot it held never
   * came back. It still has to wait on its outstanding orders; it just has
   * nothing to close afterwards.
   */
  it('settles a card sale without waiting for a jar it never had', async () => {
    sales.findClosing.mockResolvedValue([
      closingOrder({ saleMethod: SaleMethod.CARD, jarClosedAt: null }),
    ])

    await service.settleFinishedClosings()

    expect(orders.findUnsettledByCard).toHaveBeenCalledWith(CARD_ID)
    expect(cancel.settle).toHaveBeenCalled()
  })

  it('still waits on a card sale whose orders are outstanding', async () => {
    orders.findUnsettledByCard.mockResolvedValue([pending()])
    sales.findClosing.mockResolvedValue([
      closingOrder({ saleMethod: SaleMethod.CARD, jarClosedAt: null }),
    ])

    await service.settleFinishedClosings()

    expect(cancel.settle).not.toHaveBeenCalled()
  })

  /** And a jar sale is unchanged: an open jar still holds the settlement. */
  it('keeps waiting on a jar sale with the method spelled out', async () => {
    sales.findClosing.mockResolvedValue([
      closingOrder({ saleMethod: SaleMethod.JAR, jarClosedAt: null }),
    ])

    await service.settleFinishedClosings()

    expect(cancel.settle).not.toHaveBeenCalled()
  })

  /** No terminal means nothing could ever be paid into it. */
  it('settles an order that never got a terminal without asking', async () => {
    sales.findClosing.mockResolvedValue([closingOrder({ cardId: null, jarClosedAt: null })])

    await service.settleFinishedClosings()

    expect(orders.findUnsettledByCard).not.toHaveBeenCalled()
    expect(cancel.settle).toHaveBeenCalled()
  })

  it('does nothing when no order is winding down', async () => {
    sales.findClosing.mockResolvedValue([])

    await service.settleFinishedClosings()

    expect(orders.findUnsettledByCard).not.toHaveBeenCalled()
    expect(cancel.settle).not.toHaveBeenCalled()
  })

  /** One user's failure must not strand every other order behind it. */
  it('carries on after one order fails to settle', async () => {
    sales.findClosing.mockResolvedValue([
      closingOrder({ publicId: 'FIRST' }),
      closingOrder({ publicId: 'SECOND' }),
    ])
    cancel.settle.mockRejectedValueOnce(new Error('mongo is down'))

    await expect(service.settleFinishedClosings()).resolves.toBeUndefined()

    expect(cancel.settle).toHaveBeenCalledTimes(2)
  })

  it('survives the sweep query itself failing', async () => {
    sales.findClosing.mockRejectedValue(new Error('mongo is down'))

    await expect(service.settleFinishedClosings()).resolves.toBeUndefined()
  })

  /**
   * A settlement moves money. Two passes overlapping would each read the same
   * order and each try to unwind it — the status guard in `cancelIfOpen` stops
   * a double refund, but there is no reason to race it.
   */
  it('runs one pass at a time', async () => {
    let release: () => void = () => undefined
    sales.findClosing.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve([]) }),
    )

    const first = service.settleFinishedClosings()
    await service.settleFinishedClosings()

    expect(sales.findClosing).toHaveBeenCalledTimes(1)

    release()
    await first
  })

  it('is free to run again once the previous pass finished', async () => {
    await service.settleFinishedClosings()
    await service.settleFinishedClosings()

    expect(sales.findClosing).toHaveBeenCalledTimes(2)
  })
})
