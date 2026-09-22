import {
  SaleEventType,
  SaleRemainderPolicy,
  TmaSaleStatus,
  WsEventNames
} from '@transacto/contracts'
import { OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db'
import { TraderWsEvent, TerminalOrdersExecutedEvent } from 'src/shared/interfaces'
import { SaleProgressListener } from './sale-progress.listener'
import { SaleSettlementService } from './sale-settlement.service'
import type { SaleCardOrderService } from './sale-card-order.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { SaleProgressService } from './sale-progress.service'
import type { SaleFacadeService } from './sale-facade.service'
import type { SaleComplianceService } from './sale-compliance.service'
import type { OrderDbService } from 'src/modules/repositories/order-db'
import type { SaleTerminalService } from './sale-terminal.service'
import type { SalePayoutTargetService } from './sale-payout-target.service'
import type { EventEmitter2 } from '@nestjs/event-emitter'

const CARD_ID = 4242
const TERMINAL_ID = 23715
const TRADER_ID = 346

/** A sale mid-flight: terminal created, no money in yet. */
const openOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'Z38SL69F',
  telegramId: 885140,
  cardId: CARD_ID,
  transactoTerminalId: TERMINAL_ID,
  traderId: TRADER_ID,
  fiatAmount: 404_000,
  receivedAmount: 0,
  jarBalance: null,
  status: TmaSaleStatus.TERMINAL_READY,
  events: [],
  ...overrides,
})

const executed = (orderId: number, amount: number) => ({
  orderId,
  amount,
  status: OrderStatus.EXECUTED,
  executionReason: OrderExecutionReason.FULL_MATCH,
})

describe('SaleProgressListener', () => {
  let db: {
    findOpenByCardId: jest.Mock
    updateJarBalance: jest.Mock
    appendEvent: jest.Mock
    creditExecutedOrder: jest.Mock
    markAwaitingFiat: jest.Mock
  }
  let progress: { emit: jest.Mock }
  let facade: { completeSale: jest.Mock }
  let compliance: { check: jest.Mock }
  let orders: { findUnsettledByCard: jest.Mock }
  let terminals: { stopRouting: jest.Mock }
  let payoutTarget: { resolve: jest.Mock }
  let emitter: { emit: jest.Mock }
  let listener: SaleProgressListener

  const originalMinOrder = process.env.TRANSACTO_MIN_ORDER_KOPECKS

  beforeEach(() => {
    // ₴300, the shipped default — pinned rather than inherited so these tests
    // say what they are measuring.
    process.env.TRANSACTO_MIN_ORDER_KOPECKS = '30000'

    db = {
      findOpenByCardId: jest.fn().mockResolvedValue(openOrder()),
      updateJarBalance: jest.fn().mockImplementation(async (_id, jarBalance) =>
        openOrder({ jarBalance })
      ),
      appendEvent: jest.fn().mockImplementation(async () => openOrder()),
      creditExecutedOrder: jest
        .fn()
        .mockImplementation(async (_id, _orderId, amount) => openOrder({ receivedAmount: amount })),
      markAwaitingFiat: jest.fn().mockResolvedValue(openOrder()),
      // The gate on entering a tail: the first caller gets the document back,
      // every later one gets `null`. Its own filter is what decides that; here
      // it answers as the first.
      markTailReached: jest.fn().mockImplementation(async () => openOrder()),
      // The second gate: told once, and only once nothing is left to ask the
      // seller for. Answers as the first caller here.
      markTailAnnounced: jest.fn().mockImplementation(async () => openOrder()),
    }
    progress = { emit: jest.fn().mockResolvedValue(undefined) }
    facade = { completeSale: jest.fn().mockResolvedValue(true) }

    // Compliant by default: the two post-creation rules have their own spec,
    // and every test here is about progress rather than enforcement.
    compliance = { check: jest.fn().mockResolvedValue(false) }
    // Nothing in flight by default; the tail rule's guard has its own tests.
    orders = { findUnsettledByCard: jest.fn().mockResolvedValue([]) }

    // The real settlement service over the same doubles. When it was private
    // to the listener these assertions tested it through this class; it moved
    // because the card variant settles through a path this listener never sees,
    // and a stub here would leave every completion rule passing against nothing.
    // What a sale entering its tail does upstream: no new payers, still watched.
    terminals = { stopRouting: jest.fn().mockResolvedValue(undefined) }
    // Where an operator would be asked to transfer the tail. A jar link here,
    // since every sale in this file is a jar sale.
    payoutTarget = { resolve: jest.fn().mockResolvedValue('https://example.test/jar/abc') }
    emitter = { emit: jest.fn() }

    const settlement = new SaleSettlementService(
      db as unknown as TmaSaleDbService,
      facade as unknown as SaleFacadeService,
      orders as unknown as OrderDbService,
      terminals as unknown as SaleTerminalService,
      payoutTarget as unknown as SalePayoutTargetService,
      emitter as unknown as EventEmitter2,
    )

    listener = new SaleProgressListener(
      db as unknown as TmaSaleDbService,
      progress as unknown as SaleProgressService,
      facade as unknown as SaleFacadeService,
      compliance as unknown as SaleComplianceService,
      orders as unknown as OrderDbService,
      settlement,
      // Every sale in this file is a jar sale, so the card path is never
      // reached. Stubbed rather than omitted: `undefined` in a positional list
      // is how the next reordering goes unnoticed.
      { recordArrival: jest.fn(async () => null) } as unknown as SaleCardOrderService,
    )
  })

  afterEach(() => {
    if (originalMinOrder === undefined) delete process.env.TRANSACTO_MIN_ORDER_KOPECKS
    else process.env.TRANSACTO_MIN_ORDER_KOPECKS = originalMinOrder
  })

  const balanceEvent = (currentBalance: number, terminalName = 'TMA-Z38SL69F') =>
    new TraderWsEvent(TRADER_ID, WsEventNames.TERMINAL_BALANCE_UPDATED, {
      terminalId: TERMINAL_ID,
      cardId: CARD_ID,
      terminalName,
      currentBalance,
    })

  describe('jar balance updates', () => {
    it('records the balance and pushes a snapshot', async () => {
      await listener.handleTraderWsEvent(balanceEvent(120_000))

      expect(db.updateJarBalance).toHaveBeenCalledWith('order-1', 120_000)
      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    it('stays silent when the balance has not moved', async () => {
      // The scraper re-broadcasts an unchanged balance every 15s as a heartbeat.
      // updateJarBalance returns null in that case, and a push per heartbeat
      // would be pure noise on the client.
      db.updateJarBalance.mockResolvedValue(null)

      await listener.handleTraderWsEvent(balanceEvent(120_000))

      expect(progress.emit).not.toHaveBeenCalled()
    })

    it('ignores trader events that are not balance updates', async () => {
      await listener.handleTraderWsEvent(
        new TraderWsEvent(TRADER_ID, WsEventNames.TERMINAL_HISTORY_UPDATED, { cardId: CARD_ID }),
      )

      expect(db.findOpenByCardId).not.toHaveBeenCalled()
    })

    it('ignores a card that belongs to no open sale', async () => {
      db.findOpenByCardId.mockResolvedValue(null)

      await listener.handleTraderWsEvent(balanceEvent(120_000))

      expect(db.updateJarBalance).not.toHaveBeenCalled()
      expect(progress.emit).not.toHaveBeenCalled()
    })

    /**
     * This channel carries a broadcast for every terminal of every trader on a
     * 15-second heartbeat, and almost all of them belong to extension traders.
     * Reaching the database to discover that costs a round trip per terminal
     * per heartbeat; the TMA name prefix answers it for free.
     */
    it('does not query the database for a terminal that is not a Mini App one', async () => {
      await listener.handleTraderWsEvent(balanceEvent(120_000, 'Моно Тест'))

      expect(db.findOpenByCardId).not.toHaveBeenCalled()
    })

    /**
     * The last stretch cannot be sold: no payer is routed an order for
     * ₴212, so the user pays it in themselves — which produces a balance
     * change and nothing else. Before this, the jar sat at 100% while the
     * order stayed AWAITING_FIAT and the stake stayed frozen.
     */
    it('closes the order once the jar is full and only the tail is unmatched', async () => {
      db.updateJarBalance.mockResolvedValue(
        openOrder({ receivedAmount: 380_000, jarBalance: 404_000 }),
      )

      await listener.handleTraderWsEvent(balanceEvent(404_000))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    /**
     * The bound on that. A jar its owner filled end to end proves no selling
     * happened at all, and closing on it would hand back the stake plus the
     * profit for nothing.
     */
    it('leaves the order open when more than the tail is unmatched', async () => {
      db.updateJarBalance.mockResolvedValue(openOrder({ receivedAmount: 0, jarBalance: 404_000 }))

      await listener.handleTraderWsEvent(balanceEvent(404_000))

      expect(facade.completeSale).not.toHaveBeenCalled()
      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    /**
     * The heartbeat writes nothing when the balance has not moved, which is
     * exactly the state a jar that filled while nobody was completing on it is
     * stuck in. Funding is judged on the balance the scrape carries, so such an
     * order closes on the next tick rather than waiting for a change that will
     * never come.
     */
    it('closes a jar that is already full even though the write was a no-op', async () => {
      db.findOpenByCardId.mockResolvedValue(
        openOrder({ receivedAmount: 380_000, jarBalance: 404_000 }),
      )
      db.updateJarBalance.mockResolvedValue(null)

      await listener.handleTraderWsEvent(balanceEvent(404_000))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    /**
     * Funding outranks every rule about how the order was set up. An order
     * whose target has arrived is finished, and blocking it at that point
     * strands the payer's hryvnia *and* the user's stake with no path to
     * either.
     */
    it('does not put a funded order through the compliance rules', async () => {
      db.updateJarBalance.mockResolvedValue(
        openOrder({ receivedAmount: 380_000, jarBalance: 404_000 }),
      )

      await listener.handleTraderWsEvent(balanceEvent(404_000))

      expect(compliance.check).not.toHaveBeenCalled()
    })

    it('still runs the compliance rules on an order that is not funded', async () => {
      await listener.handleTraderWsEvent(balanceEvent(120_000))

      expect(compliance.check).toHaveBeenCalled()
    })

    it('still queries for a Mini App terminal', async () => {
      await listener.handleTraderWsEvent(balanceEvent(120_000, 'TMA-Z38SL69F'))

      expect(db.findOpenByCardId).toHaveBeenCalledWith(CARD_ID)
    })
  })

  describe('orders arriving on the terminal', () => {
    it('records an incoming order and moves the sale to AWAITING_FIAT', async () => {
      await listener.handleTerminalStateChanged({
        cardId: CARD_ID,
        context: { orderEvents: [{ orderId: 900, amount: 404_000, status: OrderStatus.PENDING }] },
      })

      expect(db.markAwaitingFiat).toHaveBeenCalledWith('order-1')
      expect(db.appendEvent).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ type: SaleEventType.ORDER_RECEIVED, orderId: 900 }),
      )
    })

    it('does not treat a cancellation as progress', async () => {
      await listener.handleTerminalStateChanged({
        cardId: CARD_ID,
        context: { orderEvents: [{ orderId: 900, amount: 404_000, status: OrderStatus.CANCELLED }] },
      })

      expect(db.markAwaitingFiat).not.toHaveBeenCalled()
      expect(db.appendEvent).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ type: SaleEventType.ORDER_CANCELLED }),
      )
    })

    it('ignores an event with no order payload', async () => {
      await listener.handleTerminalStateChanged({ cardId: CARD_ID, context: { orderEvents: [] } })

      expect(db.findOpenByCardId).not.toHaveBeenCalled()
    })

    /**
     * The third case this channel carries, and the one that used to be lost.
     * An order settled through the Transacto panel — or reported paid by the
     * 30-second order sync — stops being PENDING, so the scraper's matcher can
     * never match it and `terminal.orders_executed` never fires. Treated as a
     * mere "order received" it left the sale stuck at AWAITING_FIAT
     * with the user's USDT frozen and no path to release it.
     */
    it('credits an order settled through the admin panel as money arriving', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 404_000 }))

      await listener.handleTerminalStateChanged({
        cardId: CARD_ID,
        context: {
          orderEvents: [
            {
              orderId: 900,
              amount: 404_000,
              status: OrderStatus.EXECUTED,
              executionReason: OrderExecutionReason.ADMIN_PANEL,
            },
          ],
        },
      })

      expect(db.creditExecutedOrder).toHaveBeenCalledWith('order-1', 900, 404_000, expect.any(Number))
      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    it('does not record an admin-settled order as a new incoming order', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 200_000 }))

      await listener.handleTerminalStateChanged({
        cardId: CARD_ID,
        context: {
          orderEvents: [
            {
              orderId: 900,
              amount: 200_000,
              status: OrderStatus.EXECUTED,
              executionReason: OrderExecutionReason.ADMIN_PANEL,
            },
          ],
        },
      })

      expect(db.appendEvent).not.toHaveBeenCalled()
      expect(db.markAwaitingFiat).not.toHaveBeenCalled()
    })

    /**
     * `emitStateChanged` spreads its document; before it was switched to
     * `.lean()` that produced `{ $__, _doc }`, so every field arrived undefined
     * while `cardId` still passed the guard. Pricing such an event would
     * corrupt the running total with NaN.
     */
    it('refuses to credit a settled order that carries no amount', async () => {
      await listener.handleTerminalStateChanged({
        cardId: CARD_ID,
        context: { orderEvents: [{ status: OrderStatus.EXECUTED }] },
      })

      expect(db.creditExecutedOrder).not.toHaveBeenCalled()
      expect(facade.completeSale).not.toHaveBeenCalled()
    })
  })

  describe('money arriving', () => {
    const ordersExecuted = (...orders: ReturnType<typeof executed>[]) =>
      new TerminalOrdersExecutedEvent(TERMINAL_ID, TRADER_ID, CARD_ID, orders, 404_000)

    it('credits the matched amount against the order', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 200_000 }))

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 200_000)))

      expect(db.creditExecutedOrder).toHaveBeenCalledWith(
        'order-1',
        900,
        200_000,
        expect.any(Number),
      )
    })

    it('leaves a partially funded order open', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 200_000 }))

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 200_000)))

      expect(facade.completeSale).not.toHaveBeenCalled()
      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    it('completes the order once the full target has arrived', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 404_000 }))

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 404_000)))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    it('completes on an overpayment too, not only an exact match', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 450_000 }))

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 450_000)))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    /**
     * The same order can be reported settled twice — once by the scraper
     * matching a jar delta, once by Transacto reporting it paid. The atomic
     * `creditedOrderIds` guard returns null the second time, and the listener
     * must then leave the running total exactly where it was.
     */
    it('ignores a repeat report of an order it already credited', async () => {
      db.creditExecutedOrder.mockResolvedValue(null)

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 404_000)))

      // Still at the pre-existing receivedAmount of 0, so nothing completes.
      expect(facade.completeSale).not.toHaveBeenCalled()
      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    it('does not double-announce when completion already pushed its own snapshot', async () => {
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 404_000 }))

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 404_000)))

      expect(progress.emit).not.toHaveBeenCalled()
    })

    it('still announces when completion found the order already closed', async () => {
      // A concurrent match won the race; the order is closed but this snapshot
      // still carries timeline entries the client has not seen.
      db.creditExecutedOrder.mockResolvedValue(openOrder({ receivedAmount: 404_000 }))
      facade.completeSale.mockResolvedValue(false)

      await listener.handleOrdersExecuted(ordersExecuted(executed(900, 404_000)))

      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    it('accumulates several orders settled in one scrape', async () => {
      db.creditExecutedOrder
        .mockResolvedValueOnce(openOrder({ receivedAmount: 200_000 }))
        .mockResolvedValueOnce(openOrder({ receivedAmount: 404_000 }))

      await listener.handleOrdersExecuted(
        ordersExecuted(executed(900, 200_000), executed(901, 204_000)),
      )

      expect(db.creditExecutedOrder).toHaveBeenCalledTimes(2)
      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })
  })

  /**
   * These handlers run on the scraper's hot path. A Mini App bookkeeping failure
   * must never propagate into a scrape or a trader's order execution.
   */
  describe('failure containment', () => {
    it('swallows a database failure rather than breaking the scrape', async () => {
      db.findOpenByCardId.mockRejectedValue(new Error('mongo is down'))

      await expect(listener.handleTraderWsEvent(balanceEvent(1))).resolves.toBeUndefined()
      await expect(
        listener.handleOrdersExecuted(
          new TerminalOrdersExecutedEvent(TERMINAL_ID, TRADER_ID, CARD_ID, [executed(1, 1)], 1),
        ),
      ).resolves.toBeUndefined()
    })
  })

  /**
   * The tail: a gap too small for the pipeline to route an order for. An order
   * created with REFUND_TO_BALANCE gets it back as USDT instead of waiting for
   * somebody to pay it in by hand.
   */
  describe('an unfillable remainder', () => {
    const refunding = (over: Record<string, unknown> = {}) =>
      openOrder({
        remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
        openingJarBalance: 0,
        receivedAmount: 380_000,
        jarBalance: 380_000,
        ...over,
      })

    const seed = (order: Record<string, unknown>) => {
      db.findOpenByCardId.mockResolvedValue(order)
      db.updateJarBalance.mockResolvedValue(order)
      db.creditExecutedOrder.mockResolvedValue(order)
    }

    it('closes the order once the gap is smaller than one order', async () => {
      seed(refunding())

      await listener.handleTraderWsEvent(balanceEvent(380_000))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    it('leaves a WAIT_FOR_TOP_UP order open at the same point', async () => {
      seed(refunding({ remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP }))

      await listener.handleTraderWsEvent(balanceEvent(380_000))

      expect(facade.completeSale).not.toHaveBeenCalled()
    })

    it('leaves it open while the gap could still be filled', async () => {
      seed(refunding({ receivedAmount: 300_000, jarBalance: 300_000 }))

      await listener.handleTraderWsEvent(balanceEvent(300_000))

      expect(facade.completeSale).not.toHaveBeenCalled()
    })

    /**
     * The arithmetic says no order this small can exist, but one raised while
     * there *was* room can still be unsettled — an appeal above all. Closing
     * now would refund the tail, retire the terminal, and leave the user with
     * both that refund and the money when the appeal resolved.
     */
    it('waits while an order on the card is still unsettled', async () => {
      seed(refunding())
      orders.findUnsettledByCard.mockResolvedValue([{ orderId: 1 }])

      await listener.handleTraderWsEvent(balanceEvent(380_000))

      expect(facade.completeSale).not.toHaveBeenCalled()
    })

    /**
     * A jar that actually reached its target settles as a full fill, so the
     * in-flight check must not be reached — it would refuse a completion that
     * has nothing to do with a tail.
     */
    it('does not consult that check for an order that is simply funded', async () => {
      seed(refunding({ receivedAmount: 404_000, jarBalance: 404_000 }))
      orders.findUnsettledByCard.mockResolvedValue([{ orderId: 1 }])

      await listener.handleTraderWsEvent(balanceEvent(404_000))

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
      expect(orders.findUnsettledByCard).not.toHaveBeenCalled()
    })

    /** Executed orders reach the same rule by a different signal. */
    it('closes on an executed order that leaves only a tail', async () => {
      seed(refunding())

      await listener.handleOrdersExecuted({
        cardId: CARD_ID,
        orders: [executed(9001, 80_000)],
      } as unknown as TerminalOrdersExecutedEvent)

      expect(facade.completeSale).toHaveBeenCalledWith('order-1')
    })

    /**
     * **A tail is what nothing may be routed into**, and that holds whichever
     * ending the sale asked for.
     *
     * `SaleCardLimitsService` stops retuning the credential the moment the
     * remainder drops under the floor, so the window upstream keeps whatever it
     * was last given — on a ₴100 tail that is a window for a whole order. A
     * payer routed into it overshoots the target, and the seller receives more
     * hryvnia than the USDT they were charged for.
     */
    describe('when the tail is reached', () => {
      const waiting = (over: Record<string, unknown> = {}) =>
        refunding({ remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP, ...over })

      it('stamps the sale and stands routing down', async () => {
        seed(waiting())

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailReached).toHaveBeenCalledWith('order-1')
        expect(terminals.stopRouting).toHaveBeenCalledWith(
          expect.objectContaining({ publicId: 'Z38SL69F' }),
          'Tail reached',
        )
      })

      /**
       * Stood down, never switched off. `stopRouting` leaves `enabled` alone so
       * the terminal keeps being scraped — which is the whole of how a jar
       * sale's manual top-up is ever seen.
       */
      it('does not take the terminal out of service', async () => {
        seed(waiting())

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(facade.completeSale).not.toHaveBeenCalled()
      })

      /**
       * Every jar scrape asks the same question again, so the write is the gate:
       * a sale already stamped gets no second call upstream.
       */
      it('does it once, however often the figures are re-examined', async () => {
        seed(waiting())
        db.markTailReached.mockResolvedValue(null)

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(terminals.stopRouting).not.toHaveBeenCalled()
      })

      /** And the cheap pre-check costs nothing when the document already says so. */
      it('does not even ask once the sale carries the stamp', async () => {
        seed(waiting({ tailReachedAt: new Date('2026-09-20T14:52:00Z') }))

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailReached).not.toHaveBeenCalled()
        expect(terminals.stopRouting).not.toHaveBeenCalled()
      })

      it('leaves routing alone while the gap could still be filled', async () => {
        seed(waiting({ receivedAmount: 300_000, jarBalance: 300_000 }))

        await listener.handleTraderWsEvent(balanceEvent(300_000))

        expect(db.markTailReached).not.toHaveBeenCalled()
        expect(terminals.stopRouting).not.toHaveBeenCalled()
      })

      /**
       * A funded sale has no tail, and parking one would stand down a terminal
       * the completion is about to tear down anyway.
       */
      it('parks nothing on a sale that simply reached its target', async () => {
        seed(waiting({ receivedAmount: 404_000, jarBalance: 404_000 }))

        await listener.handleTraderWsEvent(balanceEvent(404_000))

        expect(facade.completeSale).toHaveBeenCalledWith('order-1')
        expect(db.markTailReached).not.toHaveBeenCalled()
      })

      /**
       * The stamp is the gate and it is written first, deliberately. A stamped
       * sale whose routing failed to come down is visible, bounded by the window
       * upstream and says so in an error line; an unstamped one is a sale
       * nobody is ever told about, and its tail is the part that needs a person.
       */
      it('keeps the stamp when routing could not be stood down', async () => {
        seed(waiting())
        terminals.stopRouting.mockRejectedValue(new Error('no service trader'))

        await expect(listener.handleTraderWsEvent(balanceEvent(380_000))).resolves.toBeUndefined()

        expect(db.markTailReached).toHaveBeenCalledWith('order-1')
      })

      /** The refunding ending reaches the same park on its way to closing. */
      it('parks a refunding sale too, before it settles', async () => {
        seed(refunding())
        orders.findUnsettledByCard.mockResolvedValue([{ orderId: 1 }])

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailReached).toHaveBeenCalledWith('order-1')
        expect(facade.completeSale).not.toHaveBeenCalled()
      })
    })

    /**
     * Somebody has to transfer the last stretch, and somebody has to be told.
     *
     * **These assertions are on the emitter rather than on a message**, because
     * the settlement rules must not know a Telegram group exists — they publish
     * a neutral fact and `SupportAlertsListener` decides it is worth a sentence.
     */
    describe('asking an operator to close the tail', () => {
      const waiting = (over: Record<string, unknown> = {}) =>
        refunding({ remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP, ...over })

      const announced = () =>
        emitter.emit.mock.calls.find(([name]) => name === 'tma.sale_tail_reached')?.[1]

      it('announces the tail with the sum and where it has to go', async () => {
        seed(waiting())

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailAnnounced).toHaveBeenCalledWith('order-1')
        expect(announced()).toMatchObject({
          publicId: 'Z38SL69F',
          tailKopecks: 24_000,
          fiatAmount: 404_000,
          receivedAmount: 380_000,
          payoutTarget: 'https://example.test/jar/abc',
        })
      })

      /**
       * The destination is an answer, not a requirement. An alert that cannot
       * name one is still worth sending — the sum and the sale are what make it
       * actionable, and the message says to look in the panel.
       */
      it('announces it even when the destination could not be read', async () => {
        seed(waiting())
        payoutTarget.resolve.mockResolvedValue(null)

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(announced()).toMatchObject({ payoutTarget: null })
      })

      /** Told once. Every jar scrape asks the same question again. */
      it('does not tell them twice', async () => {
        seed(waiting())
        db.markTailAnnounced.mockResolvedValue(null)

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(announced()).toBeUndefined()
      })

      it('does not even ask once the sale carries the stamp', async () => {
        seed(
          waiting({
            tailAnnouncedAt: new Date('2026-09-20T15:00:00Z'),
            tailAlertMessageId: 4_411,
          }),
        )

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailAnnounced).not.toHaveBeenCalled()
        expect(payoutTarget.resolve).not.toHaveBeenCalled()
      })

      /**
       * **Announced is not the same as answerable.** A reply takes a tail on by
       * quoting the message that asked for it, so an alert whose id was never
       * recorded can never be answered — the seller cannot confirm the transfer
       * and nobody can claim it. Every tail announced before the answer existed
       * is in that state.
       */
      it('asks again when the first alert was never recorded', async () => {
        seed(waiting({ tailAnnouncedAt: new Date('2026-09-20T15:00:00Z') }))

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(announced()).toMatchObject({ tailKopecks: 24_000 })
      })

      /**
       * …and the repair does not restart the seller's wait. It has been running
       * since the first alert, and re-stamping it would take away a release they
       * may already have earned because *our* write was what failed.
       */
      it('does not restamp the sale when it asks again', async () => {
        seed(waiting({ tailAnnouncedAt: new Date('2026-09-20T15:00:00Z') }))

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailAnnounced).not.toHaveBeenCalled()
      })

      /**
       * **Held while a declared shortfall has not been through a statement.**
       * That document is about to correct the very figure an operator would be
       * told to transfer — ₴4 of it, on the sale this was written for — so
       * nobody is asked to send a number that is about to move. Whatever accepts
       * the statement re-examines the figures, which is what brings it back.
       */
      it('waits for a statement that may still correct the figure', async () => {
        seed(
          waiting({
            cardOrders: [{ orderId: 1, declaredAmount: 29_600, answeredAt: new Date() }],
            statementCheckpointAt: null,
          }),
        )

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailAnnounced).not.toHaveBeenCalled()
        expect(announced()).toBeUndefined()
      })

      /** And the park still happens, because that cannot wait for anybody. */
      it('parks the sale even while the announcement waits', async () => {
        seed(
          waiting({
            cardOrders: [{ orderId: 1, declaredAmount: 29_600, answeredAt: new Date() }],
            statementCheckpointAt: null,
          }),
        )

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailReached).toHaveBeenCalledWith('order-1')
      })

      /** A refunding sale needs nobody: its tail comes back on its own. */
      it('tells nobody about a tail that is about to be refunded', async () => {
        seed(refunding())

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(db.markTailAnnounced).not.toHaveBeenCalled()
        expect(announced()).toBeUndefined()
      })

      it('tells nobody while the gap could still be filled', async () => {
        seed(waiting({ receivedAmount: 300_000, jarBalance: 300_000 }))

        await listener.handleTraderWsEvent(balanceEvent(300_000))

        expect(db.markTailAnnounced).not.toHaveBeenCalled()
      })

      /**
       * The destination is resolved before the gate is taken, so a sale is never
       * stamped as announced on the strength of a message that was never
       * composed.
       */
      it('resolves the destination before taking the gate', async () => {
        seed(waiting())
        const order: string[] = []
        payoutTarget.resolve.mockImplementation(async () => {
          order.push('resolve')

          return null
        })
        db.markTailAnnounced.mockImplementation(async () => {
          order.push('mark')

          return openOrder()
        })

        await listener.handleTraderWsEvent(balanceEvent(380_000))

        expect(order).toEqual(['resolve', 'mark'])
      })
    })
  })
})
