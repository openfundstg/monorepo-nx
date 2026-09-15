import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleRemainderPolicy } from '@transacto/contracts'
import { BalanceProcessorService } from './balance-processor.service'
import { AlertType } from 'src/modules/repositories/alerts-db/schemas'
import type { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import type { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { OrderDbService } from 'src/modules/repositories/order-db'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TerminalStateCacheService } from './terminal-state-cache.service'
import type { TerminalErrorHandlerService } from './terminal-error-handler.service'
import type { OrderMatcherService } from './order-matcher.service'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import type { ScraperJobData } from 'src/shared/constants'

const TERMINAL_ID = 23_892
const TRADER_ID = 346
const CARD_ID = 100

/** ₴1 000 goal, ₴850 in the jar — ₴150 left, inside the ₴300 floor. */
const GOAL = 100_000
const BALANCE = 85_000

const jobData: ScraperJobData = {
  terminalId: TERMINAL_ID,
  targetId: 'abc',
  targetUrl: 'https://send.monobank.ua/jar/abc',
  apiToken: 'token',
  traderId: TRADER_ID,
  cardId: CARD_ID,
}

/**
 * "Jar almost full" tells a trader the pipeline has run out of room and the
 * last stretch is theirs to pay in by hand. A sale set to refund its
 * tail closes itself at exactly that moment instead, so the alert fires on the
 * same scrape that completes the order and asks for an action that is already
 * unnecessary by the time it is read.
 */
describe('BalanceProcessorService — the jar-full warning', () => {
  let alerts: {
    getPendingAlertsOfType: jest.Mock
    createAlert: jest.Mock
    resolveAlert: jest.Mock
  }
  let sales: { findOpenByCardId: jest.Mock; isAwaitingJarClosureByCardId: jest.Mock }
  let cache: { getBaseline: jest.Mock; updateBaseline: jest.Mock; updateCurrentState: jest.Mock }
  let orders: { getPendingOrdersForCard: jest.Mock }
  let service: BalanceProcessorService

  const scrape = () =>
    service.processBalance(jobData, 'T-1', 'send-id', BALANCE, GOAL, 0, BALANCE)

  beforeEach(() => {
    alerts = {
      getPendingAlertsOfType: jest.fn().mockResolvedValue([]),
      createAlert: jest.fn().mockResolvedValue({
        alert: { type: AlertType.TERMINAL_FULL_WARNING, metadata: {} },
      }),
      resolveAlert: jest.fn().mockResolvedValue(undefined),
    }
    sales = {
      findOpenByCardId: jest.fn().mockResolvedValue(null),
      // No sale behind this card at all — a terminal the trader made
      // themselves, which is the case the warning exists for.
      isAwaitingJarClosureByCardId: jest.fn().mockResolvedValue(false),
    }
    cache = {
      // Baseline equals the balance, so the delta is zero and the matcher is
      // never reached — this test is only about the warning.
      getBaseline: jest.fn().mockResolvedValue(BALANCE),
      updateBaseline: jest.fn().mockResolvedValue(undefined),
      updateCurrentState: jest.fn().mockResolvedValue(undefined),
    }
    orders = { getPendingOrdersForCard: jest.fn().mockResolvedValue([]) }

    service = new BalanceProcessorService(
      {} as unknown as TerminalHistoryDbService,
      alerts as unknown as AlertsService,
      orders as unknown as OrderDbService,
      cache as unknown as TerminalStateCacheService,
      {} as unknown as TerminalErrorHandlerService,
      {} as unknown as OrderMatcherService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      sales as unknown as TmaSaleDbService,
    )
  })

  it('warns a trader whose terminal has no sale behind it', async () => {
    await scrape()

    expect(alerts.createAlert).toHaveBeenCalled()
  })

  it('still warns when the sale waits for the full amount', async () => {
    sales.findOpenByCardId.mockResolvedValue({
      remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
    })

    await scrape()

    expect(alerts.createAlert).toHaveBeenCalled()
  })

  /** Nobody has to pay this remainder in, so nobody is asked to. */
  it('stays quiet when the sale refunds its remainder', async () => {
    sales.findOpenByCardId.mockResolvedValue({
      remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
    })

    await scrape()

    expect(alerts.createAlert).not.toHaveBeenCalled()
  })

  /**
   * The user has already walked away from this jar. Asking a trader to pay the
   * last stretch in would push it to completion against the very wish that
   * stopped it — and spend the trader's own hryvnia doing so.
   */
  it('stays quiet when the user has stopped the order', async () => {
    sales.findOpenByCardId.mockResolvedValue({
      remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
      status: TmaSaleStatus.CLOSING,
    })

    await scrape()

    expect(alerts.createAlert).not.toHaveBeenCalled()
  })

  /** Still watching, still ordinary: a live order is warned about as before. */
  it('still warns while the order is running normally', async () => {
    sales.findOpenByCardId.mockResolvedValue({
      remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
      status: TmaSaleStatus.AWAITING_FIAT,
    })

    await scrape()

    expect(alerts.createAlert).toHaveBeenCalled()
  })

  /** An order stored before the choice existed behaved as "wait". */
  it('still warns when the order carries no policy', async () => {
    sales.findOpenByCardId.mockResolvedValue({ remainderPolicy: undefined })

    await scrape()

    expect(alerts.createAlert).toHaveBeenCalled()
  })

  /**
   * The sale is over and the jar is only waiting to be closed. Its remainder is
   * an artefact of its owner taking their own money out — asking a trader to
   * pay it in would be asking them to refill somebody else's emptied jar.
   */
  it('stays quiet on a jar whose sale has already ended', async () => {
    sales.isAwaitingJarClosureByCardId.mockResolvedValue(true)

    await scrape()

    expect(alerts.createAlert).not.toHaveBeenCalled()
  })

  /**
   * Suppressing a warning because a lookup failed would hide the very thing the
   * alert exists for.
   */
  it('warns anyway when the sale cannot be read', async () => {
    sales.findOpenByCardId.mockRejectedValue(new Error('mongo is down'))

    await scrape()

    expect(alerts.createAlert).toHaveBeenCalled()
  })

  /** Not near the goal at all: the question never arises. */
  it('does not even look when the jar is nowhere near its goal', async () => {
    // Baseline tracks the balance, so the delta stays zero and nothing reads
    // this as a withdrawal.
    cache.getBaseline.mockResolvedValue(10_000)

    await service.processBalance(jobData, 'T-1', 'send-id', 10_000, GOAL, 0, 10_000)

    expect(sales.findOpenByCardId).not.toHaveBeenCalled()
    expect(alerts.createAlert).not.toHaveBeenCalled()
  })
})

/**
 * A balance below the baseline is the most expensive verdict this pipeline
 * reaches — a FRAUD alert, the credential disabled, every pending order failed
 * and the loop stopped — and on one kind of jar it is simply wrong.
 *
 * Once a sale has ended, routing was switched off at the ending, so no Transacto
 * order can be sent there again and no payer can be left short. The jar is
 * watched from then on for one thing only: the closure that gives the user their
 * sale slot back. Hryvnia leaving it is its owner spending their own
 * settled money.
 */
describe('BalanceProcessorService — money leaving the jar', () => {
  /** ₴850 was in the jar; ₴400 is left. */
  const BASELINE = 85_000
  const AFTER_WITHDRAWAL = 40_000

  let errorHandler: { handleFraudOrWithdrawal: jest.Mock }
  let sales: { findOpenByCardId: jest.Mock; isAwaitingJarClosureByCardId: jest.Mock }
  let cache: { getBaseline: jest.Mock; updateBaseline: jest.Mock; updateCurrentState: jest.Mock }
  let orders: { getPendingOrdersForCard: jest.Mock; failPendingOrdersForCard: jest.Mock }
  let service: BalanceProcessorService

  const withdraw = () =>
    service.processBalance(
      jobData,
      'T-1',
      'send-id',
      AFTER_WITHDRAWAL,
      GOAL,
      AFTER_WITHDRAWAL - BASELINE,
      BASELINE
    )

  beforeEach(() => {
    errorHandler = { handleFraudOrWithdrawal: jest.fn().mockResolvedValue(undefined) }
    sales = {
      findOpenByCardId: jest.fn().mockResolvedValue(null),
      isAwaitingJarClosureByCardId: jest.fn().mockResolvedValue(false),
    }
    cache = {
      getBaseline: jest.fn().mockResolvedValue(BASELINE),
      updateBaseline: jest.fn().mockResolvedValue(undefined),
      updateCurrentState: jest.fn().mockResolvedValue(undefined),
    }
    orders = {
      getPendingOrdersForCard: jest.fn().mockResolvedValue([]),
      failPendingOrdersForCard: jest.fn().mockResolvedValue(undefined),
    }

    service = new BalanceProcessorService(
      {} as unknown as TerminalHistoryDbService,
      {
        getPendingAlertsOfType: jest.fn().mockResolvedValue([]),
        createAlert: jest.fn(),
        resolveAlert: jest.fn(),
      } as unknown as AlertsService,
      orders as unknown as OrderDbService,
      cache as unknown as TerminalStateCacheService,
      errorHandler as unknown as TerminalErrorHandlerService,
      {} as unknown as OrderMatcherService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      sales as unknown as TmaSaleDbService,
    )
  })

  /** The behaviour that is right, and that the change must not remove. */
  it('is fraud on a jar that payers can still be sent to', async () => {
    const { shouldRequeue } = await withdraw()

    expect(errorHandler.handleFraudOrWithdrawal).toHaveBeenCalled()
    expect(shouldRequeue).toBe(false)
  })

  it('is the owner spending their own money once the sale has ended', async () => {
    sales.isAwaitingJarClosureByCardId.mockResolvedValue(true)

    await withdraw()

    expect(errorHandler.handleFraudOrWithdrawal).not.toHaveBeenCalled()
  })

  /**
   * The half that matters as much as the silence. A FRAUD verdict disables the
   * terminal and stops the loop — so the jar's *closure* would then never be
   * noticed either, and the user who withdrew their own money would stay at 1/1
   * until an operator released the jar by hand.
   */
  it('keeps watching the jar, because the closure is what frees the slot', async () => {
    sales.isAwaitingJarClosureByCardId.mockResolvedValue(true)

    const { shouldRequeue } = await withdraw()

    expect(shouldRequeue).toBe(true)
  })

  /**
   * Left standing, the old baseline re-reads the same withdrawal on every
   * scrape — and measures a late payer's hryvnia against a jar balance that no
   * longer exists.
   */
  it('rebases the baseline to what is actually in the jar', async () => {
    sales.isAwaitingJarClosureByCardId.mockResolvedValue(true)

    await withdraw()

    expect(cache.updateBaseline).toHaveBeenCalledWith(
      TERMINAL_ID,
      AFTER_WITHDRAWAL,
      expect.anything()
    )
  })

  /**
   * Fails towards the alert. A false alarm is dismissed by an operator; the
   * other direction is silence about a jar being emptied.
   */
  it('still raises fraud when the sale cannot be read', async () => {
    sales.isAwaitingJarClosureByCardId.mockRejectedValue(new Error('mongo is down'))

    await withdraw()

    expect(errorHandler.handleFraudOrWithdrawal).toHaveBeenCalled()
  })
})
