import { OrderDbService } from './order-db.service'
import { OrderStatus } from '../schemas'
import type { Model } from 'mongoose'
import type { OrderDocument } from '../schemas'

const ORDER_ID = 77_001

describe('OrderDbService.isTracked', () => {
  let findOne: jest.Mock
  let service: OrderDbService

  const withStatus = (status: OrderStatus | null) => {
    findOne.mockReturnValue({ lean: () => Promise.resolve(status && { orderId: ORDER_ID, status }) })
  }

  beforeEach(() => {
    findOne = jest.fn()
    service = new OrderDbService({ findOne } as unknown as Model<OrderDocument>)
  })

  it('is false for an order we have never seen', async () => {
    withStatus(null)

    await expect(service.isTracked(ORDER_ID)).resolves.toBe(false)
  })

  it.each([OrderStatus.PENDING, OrderStatus.PAUSED])('is true while %s', async (status) => {
    withStatus(status)

    await expect(service.isTracked(ORDER_ID)).resolves.toBe(true)
  })

  /**
   * The bug this closes. `track()` upserts with `status: PENDING`
   * unconditionally, so any caller that asked this first and got `false` put a
   * settled order back into the polling queue.
   *
   * `orders_list` reports an order as `status_id === 2` until Transacto's own
   * state catches up — which, for one refused with 108, is never until a human
   * confirms it — so the 30-second sync resurrected it, re-matched it, and
   * asked Transacto to execute it again, on a loop.
   */
  it('is true once the order is EXECUTED, so it cannot be re-enqueued', async () => {
    withStatus(OrderStatus.EXECUTED)

    await expect(service.isTracked(ORDER_ID)).resolves.toBe(true)
  })

  /**
   * CANCELLED stays re-enqueueable on purpose: the stale check closes orders
   * that merely fell out of the top 100, and one that reappears upstream has to
   * be allowed back rather than staying wrongly dead.
   */
  it('is false for a CANCELLED order, which may legitimately come back', async () => {
    withStatus(OrderStatus.CANCELLED)

    await expect(service.isTracked(ORDER_ID)).resolves.toBe(false)
  })
})

describe('OrderDbService state-change events', () => {
  let findOneAndUpdate: jest.Mock
  let emit: jest.Mock
  let service: OrderDbService

  const settlesTo = (order: unknown) => {
    findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(order) })
  }

  const eventsNamed = (name: string) => emit.mock.calls.filter(([event]) => event === name)

  beforeEach(() => {
    findOneAndUpdate = jest.fn()
    emit = jest.fn()
    service = new OrderDbService({ findOneAndUpdate } as unknown as Model<OrderDocument>, {
      emit,
    } as never)
  })

  /**
   * The event that makes a webhook visible on the dashboard. `pendingOrdersSum`
   * used to reach the extension only through the scraper, so an order arriving
   * or being cancelled changed nothing the trader could see until the next poll
   * — and nothing at all when the polling loop was not running.
   */
  it.each([OrderStatus.PENDING, OrderStatus.CANCELLED])(
    'announces an order that became %s',
    async (status) => {
      settlesTo({ orderId: ORDER_ID, cardId: 100, status })

      await service.markCompleted(ORDER_ID, status)

      expect(eventsNamed('terminal.orders_changed')).toEqual([
        ['terminal.orders_changed', { cardId: 100 }],
      ])
    },
  )

  /** The history row and the dashboard refresh travel together. */
  it('still writes the history event alongside it', async () => {
    settlesTo({ orderId: ORDER_ID, cardId: 100, status: OrderStatus.CANCELLED })

    await service.markCompleted(ORDER_ID, OrderStatus.CANCELLED)

    expect(eventsNamed('terminal.state_changed')).toHaveLength(1)
  })

  /**
   * A status nobody is watching for. EXECUTED without an admin-panel reason is
   * the normal settle, and announcing every one of those would push a card to
   * the extension for a change it does not render.
   */
  it('says nothing for a state the dashboard does not show', async () => {
    settlesTo({ orderId: ORDER_ID, cardId: 100, status: OrderStatus.EXECUTED })

    await service.markCompleted(ORDER_ID, OrderStatus.EXECUTED)

    expect(emit).not.toHaveBeenCalled()
  })

  it('says nothing when the update matched no order', async () => {
    settlesTo(null)

    await service.markCompleted(ORDER_ID, OrderStatus.CANCELLED)

    expect(emit).not.toHaveBeenCalled()
  })
})
