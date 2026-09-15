import { OrderMatcherService } from './order-matcher.service'
import { OrderExecutionOutcome } from 'src/modules/transacto'
import { AlertType } from 'src/modules/repositories/alerts-db/schemas'
import { OrderExecutionReason, OrderStatus } from 'src/modules/repositories/order-db'
import { TERMINAL_ORDERS_EXECUTED } from 'src/shared/interfaces'
import type { TransactoApiService } from 'src/modules/transacto'
import type { OrderDbService } from 'src/modules/repositories/order-db'
import type { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { TerminalStateCacheService } from './terminal-state-cache.service'
import type { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'
import type { EventEmitter2 } from '@nestjs/event-emitter'

const TERMINAL_ID = 23_892
const TRADER_ID = 346
const CARD_ID = 100
const API_TOKEN = 'token'

/** One pending order for ₴500, exactly matching the delta below. */
const PENDING_ORDER = {
  orderId: 77_001,
  orderStringId: 'ORD-77001',
  traderId: TRADER_ID,
  cardId: CARD_ID,
  amount: 50_000,
  status: OrderStatus.PENDING,
}

/** Jar was empty, ₴500 arrived. */
const BASELINE = 0
const CURRENT_BALANCE = 50_000
const DELTA = 50_000

describe('OrderMatcherService — Transacto refusing to confirm', () => {
  let transacto: { executeOrder: jest.Mock }
  let orders: {
    getPendingOrdersForCard: jest.Mock
    markCompleted: jest.Mock
    markAwaitingUpstreamConfirmation: jest.Mock
    markExecutionStarted: jest.Mock
  }
  let alerts: {
    createOrderConfirmationAlert: jest.Mock
    createAlert: jest.Mock
    resolvePendingAlertsForJar: jest.Mock
  }
  let cache: { updateBaseline: jest.Mock }
  let orchestrator: { broadcastBalanceUpdate: jest.Mock }
  let emitter: { emit: jest.Mock }
  let service: OrderMatcherService

  const run = () =>
    service.processDelta(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'T-23892',
      'send-id',
      CURRENT_BALANCE,
      BASELINE,
      DELTA,
      API_TOKEN,
    )

  beforeEach(() => {
    transacto = {
      executeOrder: jest.fn().mockResolvedValue({ outcome: OrderExecutionOutcome.CONFIRMED }),
    }
    orders = {
      getPendingOrdersForCard: jest.fn().mockResolvedValue([PENDING_ORDER]),
      markCompleted: jest.fn().mockResolvedValue(true),
      // Recorded before `orders_execute`, so their `order.paid` echo of our own
      // call is not read as somebody confirming by hand.
      markExecutionStarted: jest.fn().mockResolvedValue(undefined),
      markAwaitingUpstreamConfirmation: jest.fn().mockResolvedValue(undefined),
    }
    alerts = {
      createOrderConfirmationAlert: jest.fn().mockResolvedValue({
        alert: { type: AlertType.ORDER_CONFIRMATION_FAILED, metadata: {} },
        isNew: true,
      }),
      createAlert: jest
        .fn()
        .mockResolvedValue({ alert: { type: AlertType.UNRECOGNIZED_DEPOSIT, metadata: {} }, isNew: true }),
      resolvePendingAlertsForJar: jest.fn().mockResolvedValue([]),
    }
    cache = { updateBaseline: jest.fn().mockResolvedValue(undefined) }
    orchestrator = { broadcastBalanceUpdate: jest.fn().mockResolvedValue(undefined) }
    emitter = { emit: jest.fn() }

    service = new OrderMatcherService(
      transacto as unknown as TransactoApiService,
      orders as unknown as OrderDbService,
      alerts as unknown as AlertsService,
      cache as unknown as TerminalStateCacheService,
      emitter as unknown as EventEmitter2,
      orchestrator as unknown as TerminalBalanceOrchestratorService,
    )
  })

  /**
   * The jar is one short stretch from its goal, `TERMINAL_FULL_WARNING` has told
   * the trader so, and they pay in exactly that remainder by hand. No pending
   * order accounts for it — nor could one, because Transacto cannot route an
   * order that small.
   */
  describe('when the trader pays in the last stretch themselves', () => {
    const GOAL = 926_700
    const TOP_UP = 23_000

    const topUp = () =>
      service.processDelta(
        TERMINAL_ID,
        TRADER_ID,
        CARD_ID,
        'T-23892',
        'send-id',
        GOAL,
        GOAL - TOP_UP,
        TOP_UP,
        API_TOKEN,
        GOAL,
      )

    beforeEach(() => {
      // Nothing pending, so the deposit matches nothing.
      orders.getPendingOrdersForCard.mockResolvedValue([])
    })

    /** The bug: a second alert raised for doing what the first one asked. */
    it('does not file it as an unknown deposit', async () => {
      await topUp()

      expect(alerts.createAlert).not.toHaveBeenCalled()
    })

    /** Including the full warning, whose remainder has just arrived. */
    it('clears the jar’s alerts, the full warning among them', async () => {
      await topUp()

      expect(alerts.resolvePendingAlertsForJar).toHaveBeenCalledWith(TERMINAL_ID, [
        AlertType.UNRECOGNIZED_DEPOSIT,
        AlertType.AMBIGUOUS_DEPOSIT,
        AlertType.TERMINAL_FULL_WARNING,
      ])
    })

    /**
     * Without this the same deposit is re-evaluated on every scrape and files
     * itself as unknown the moment anything else lands on top of it.
     */
    it('accounts for the money by advancing the baseline', async () => {
      const outcome = await topUp()

      expect(outcome.baselineBalance).toBe(GOAL)
      expect(cache.updateBaseline).toHaveBeenCalledWith(TERMINAL_ID, GOAL, { deferEvent: true })
    })

    it('executes nothing, because there is no order to execute', async () => {
      await topUp()

      expect(transacto.executeOrder).not.toHaveBeenCalled()
      expect(orders.markCompleted).not.toHaveBeenCalled()
    })

    /**
     * A deposit that Transacto *could* have routed an order for is not a
     * top-up, whatever the jar's balance — that one still needs explaining.
     */
    it('still files a routable amount as unknown', async () => {
      await service.processDelta(
        TERMINAL_ID,
        TRADER_ID,
        CARD_ID,
        'T-23892',
        'send-id',
        GOAL + 500_00,
        GOAL,
        500_00,
        API_TOKEN,
        GOAL,
      )

      expect(alerts.createAlert).toHaveBeenCalled()
    })

    /** A jar short of its goal has not been closed by anything. */
    it('still files a deposit as unknown while the jar is short', async () => {
      await service.processDelta(
        TERMINAL_ID,
        TRADER_ID,
        CARD_ID,
        'T-23892',
        'send-id',
        GOAL - 1,
        GOAL - 1 - TOP_UP,
        TOP_UP,
        API_TOKEN,
        GOAL,
      )

      expect(alerts.createAlert).toHaveBeenCalled()
    })
  })

  /** The happy path still has to work, and must raise nothing. */
  describe('when Transacto confirms', () => {
    it('settles the order and raises no alert', async () => {
      await run()

      expect(orders.markCompleted).toHaveBeenCalledWith(
        PENDING_ORDER.orderId,
        OrderStatus.EXECUTED,
        OrderExecutionReason.FULL_MATCH,
      )
      expect(alerts.createOrderConfirmationAlert).not.toHaveBeenCalled()
      expect(orders.markAwaitingUpstreamConfirmation).not.toHaveBeenCalled()
    })
  })

  describe('when Transacto refuses with 108', () => {
    beforeEach(() => {
      transacto.executeOrder.mockResolvedValue({
        outcome: OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED,
        errorCode: 108,
      })
    })

    /**
     * The refusal used to throw out of here, which aborted the match before any
     * of the bookkeeping below — and the scraper simply rescheduled and hit the
     * same wall seconds later, forever.
     */
    it('does not throw', async () => {
      await expect(run()).resolves.toBeDefined()
    })

    it('still credits the order locally', async () => {
      await run()

      expect(orders.markCompleted).toHaveBeenCalledWith(
        PENDING_ORDER.orderId,
        OrderStatus.EXECUTED,
        OrderExecutionReason.FULL_MATCH,
      )
    })

    it('flags it as credited here but open upstream', async () => {
      await run()

      expect(orders.markAwaitingUpstreamConfirmation).toHaveBeenCalledWith(PENDING_ORDER.orderId)
    })

    /**
     * Every value the translated sentence interpolates has to be in the
     * metadata — a figure that exists only in a log line is unreachable to the
     * extension, which renders ALERTS.ORDER_CONFIRMATION_FAILED_DESC itself.
     */
    it('raises an alert carrying everything the sentence needs', async () => {
      await run()

      expect(alerts.createOrderConfirmationAlert).toHaveBeenCalledWith(TRADER_ID, TERMINAL_ID, {
        amount: PENDING_ORDER.amount,
        orderId: PENDING_ORDER.orderId,
        orderStringId: PENDING_ORDER.orderStringId,
        errorCode: 108,
      })
    })

    /** The hryvnia is in the jar whether or not Transacto said so. */
    it('still advances the baseline to the money actually present', async () => {
      const outcome = await run()

      expect(outcome.baselineBalance).toBe(CURRENT_BALANCE)
      expect(cache.updateBaseline).toHaveBeenCalledWith(TERMINAL_ID, CURRENT_BALANCE, {
        deferEvent: true,
      })
    })

    /** Without this the Mini App never learns its sale was funded. */
    it('still announces the executed order', async () => {
      await run()

      expect(emitter.emit).toHaveBeenCalledWith(
        TERMINAL_ORDERS_EXECUTED,
        expect.objectContaining({ cardId: CARD_ID }),
      )
    })

    /** Raising the alert must never cost the settlement that already happened. */
    it('survives the alert itself failing', async () => {
      alerts.createOrderConfirmationAlert.mockRejectedValue(new Error('mongo is down'))

      const outcome = await run()

      expect(outcome.baselineBalance).toBe(CURRENT_BALANCE)
      expect(orders.markCompleted).toHaveBeenCalled()
    })
  })
})

/**
 * Two independent paths report the same order settling — the scraper matching a
 * jar delta, and Transacto's `order.paid` webhook — and both used to write a row
 * to the terminal's history.
 *
 * The webhook is not an independent observation. It fires *because* the matcher
 * called `orders_execute`, so it is our own action arriving back at us over
 * HTTP, and it lands in the window between that call returning and the local
 * write finishing. `handleOrderPaid` then settles the order with
 * `ADMIN_PANEL` — which `OrderDbService.emitStateChanged` treats as worth
 * announcing — and the trader is shown "confirmed manually" for an order nobody
 * touched by hand, immediately followed by "fully matched" for the same order.
 *
 * `markCompleted` is already the atomic gate that decides which path settled it:
 * `{ orderId, status: { $ne: status } }` means exactly one caller gets a
 * document back. The matcher simply ignored the answer.
 */
describe('OrderMatcherService — an order settled by another path first', () => {
  let transacto: { executeOrder: jest.Mock }
  let orders: {
    getPendingOrdersForCard: jest.Mock
    markCompleted: jest.Mock
    markAwaitingUpstreamConfirmation: jest.Mock
  }
  let alerts: {
    createOrderConfirmationAlert: jest.Mock
    createAlert: jest.Mock
    resolvePendingAlertsForJar: jest.Mock
  }
  let cache: { updateBaseline: jest.Mock }
  let orchestrator: { broadcastBalanceUpdate: jest.Mock }
  let emitter: { emit: jest.Mock }
  let service: OrderMatcherService

  const run = () =>
    service.processDelta(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'T-23892',
      'send-id',
      CURRENT_BALANCE,
      BASELINE,
      DELTA,
      API_TOKEN,
    )

  beforeEach(() => {
    transacto = {
      executeOrder: jest.fn().mockResolvedValue({ outcome: OrderExecutionOutcome.CONFIRMED }),
    }
    orders = {
      getPendingOrdersForCard: jest.fn().mockResolvedValue([PENDING_ORDER]),
      // The webhook got there first: the order is already EXECUTED, so the
      // status guard matches nothing and no document comes back.
      markCompleted: jest.fn().mockResolvedValue(false),
      markExecutionStarted: jest.fn().mockResolvedValue(undefined),
      markAwaitingUpstreamConfirmation: jest.fn().mockResolvedValue(undefined),
    }
    alerts = {
      createOrderConfirmationAlert: jest.fn(),
      createAlert: jest.fn().mockResolvedValue(undefined),
      resolvePendingAlertsForJar: jest.fn().mockResolvedValue(undefined),
    }
    cache = { updateBaseline: jest.fn().mockResolvedValue(undefined) }
    orchestrator = { broadcastBalanceUpdate: jest.fn().mockResolvedValue(undefined) }
    emitter = { emit: jest.fn() }

    service = new OrderMatcherService(
      transacto as unknown as TransactoApiService,
      orders as unknown as OrderDbService,
      alerts as unknown as AlertsService,
      cache as unknown as TerminalStateCacheService,
      emitter as unknown as EventEmitter2,
      orchestrator as unknown as TerminalBalanceOrchestratorService,
    )
  })

  /** The row the trader sees twice. */
  it('does not add a second history entry for an order it did not settle', async () => {
    const outcome = await run()

    expect(outcome.historyOrderEvents).toEqual([])
  })

  /**
   * Everything else must still happen. The payer's hryvnia is in the jar
   * whoever recorded the settlement, so the baseline still advances — leaving
   * it behind would make the next scrape read the same money as an
   * unrecognised deposit.
   */
  it('still advances the baseline to the money actually present', async () => {
    const outcome = await run()

    expect(outcome.baselineBalance).toBe(CURRENT_BALANCE)
    expect(cache.updateBaseline).toHaveBeenCalledWith(
      TERMINAL_ID,
      CURRENT_BALANCE,
      expect.anything(),
    )
  })

  it('still resolves the jar alerts and pushes the balance', async () => {
    await run()

    expect(alerts.resolvePendingAlertsForJar).toHaveBeenCalledWith(TERMINAL_ID)
    expect(orchestrator.broadcastBalanceUpdate).toHaveBeenCalled()
  })

  /**
   * `TERMINAL_ORDERS_EXECUTED` is derived from the same list, so it falls
   * silent here too — correctly. The path that *did* settle the order announces
   * it instead: `OrderDbService.emitStateChanged` fires `terminal.state_changed`
   * for an `ADMIN_PANEL` settlement, and the Mini App's listener treats that as
   * money arriving. The two signals are complementary by design, and the sale
   * dedupes by `creditedOrderIds` whichever reaches it.
   */
  it('leaves the announcement to the path that settled it', async () => {
    await run()

    expect(emitter.emit).not.toHaveBeenCalledWith(TERMINAL_ORDERS_EXECUTED, expect.anything())
  })
})

/**
 * The fuzzy branch records `FUZZY_MATCH` on the order document; the perfect
 * branch recorded nothing at all, so every cleanly matched order was stored
 * with an empty `executionReason` — and in the race above it kept the
 * `ADMIN_PANEL` the webhook wrote, which says a human confirmed it.
 */
describe('OrderMatcherService — how a perfect match is recorded', () => {
  let orders: {
    getPendingOrdersForCard: jest.Mock
    markCompleted: jest.Mock
    markAwaitingUpstreamConfirmation: jest.Mock
  }
  let service: OrderMatcherService

  beforeEach(() => {
    orders = {
      getPendingOrdersForCard: jest.fn().mockResolvedValue([PENDING_ORDER]),
      markCompleted: jest.fn().mockResolvedValue(true),
      // Recorded before `orders_execute`, so their `order.paid` echo of our own
      // call is not read as somebody confirming by hand.
      markExecutionStarted: jest.fn().mockResolvedValue(undefined),
      markAwaitingUpstreamConfirmation: jest.fn(),
    }

    service = new OrderMatcherService(
      {
        executeOrder: jest.fn().mockResolvedValue({ outcome: OrderExecutionOutcome.CONFIRMED }),
      } as unknown as TransactoApiService,
      orders as unknown as OrderDbService,
      {
        createOrderConfirmationAlert: jest.fn(),
        createAlert: jest.fn().mockResolvedValue(undefined),
        resolvePendingAlertsForJar: jest.fn().mockResolvedValue(undefined),
      } as unknown as AlertsService,
      { updateBaseline: jest.fn().mockResolvedValue(undefined) } as unknown as TerminalStateCacheService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {
        broadcastBalanceUpdate: jest.fn().mockResolvedValue(undefined),
      } as unknown as TerminalBalanceOrchestratorService,
    )
  })

  it('stores the reason on the order, not only on the history entry', async () => {
    await service.processDelta(
      TERMINAL_ID,
      TRADER_ID,
      CARD_ID,
      'T-23892',
      'send-id',
      CURRENT_BALANCE,
      BASELINE,
      DELTA,
      API_TOKEN,
    )

    expect(orders.markCompleted).toHaveBeenCalledWith(
      PENDING_ORDER.orderId,
      OrderStatus.EXECUTED,
      OrderExecutionReason.FULL_MATCH,
    )
  })
})
