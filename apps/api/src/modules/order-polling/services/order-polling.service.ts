import { Injectable, Logger, Inject } from '@nestjs/common'

import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import { RedisKeys } from 'src/shared/redis/redis.keys'
import { TerminalDbService } from 'src/modules/terminal'
import {
  OrderDbService,
  OrderStatus,
  OrderExecutionReason,
  type Order as TrackedOrder
} from 'src/modules/repositories/order-db'
import type { Trader } from 'src/modules/repositories/trader-db'
import type { TransactoOrder as Order, TransactoWebhookOrder } from 'src/shared/interfaces'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'

import type { ScraperJobData } from 'src/shared/constants'
import { getBankProvider, extractTargetId } from 'src/shared/utils'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import { TerminalHistoryOrderEvent } from 'src/modules/repositories/terminal-history-db/schemas'

import { TerminalStateCacheService } from 'src/modules/bank-scraper'

/**
 * How long after asking Transacto to execute an order its `order.paid` may
 * still be read as our own echo rather than as somebody's manual confirmation.
 */
const SELF_EXECUTION_ECHO_MS = 2 * 60 * 1000

@Injectable()
export class OrderPollingService {
  private readonly logger = new Logger(OrderPollingService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly terminalHistoryDbService: TerminalHistoryDbService,
    private readonly terminalStateCacheService: TerminalStateCacheService,
    @InjectQueue(BANK_SCRAPER_QUEUE_NAME) private readonly monoQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * Handles an incoming webhook order.created event.
   */
  async handleWebhookOrder(trader: Trader, orderPayload: TransactoWebhookOrder): Promise<void> {
    const { id: orderId, order_id: orderStringId, amount, card_id: cardId } = orderPayload

    if (!cardId) {
      this.logger.warn(`Order ${orderId} has no card_id, cannot resolve Monobank URL`)
      return
    }

    const alreadyTracked = await this.trackedOrderDbService.isTracked(orderId)
    if (alreadyTracked) {
      this.logger.debug(`Order ${orderId} is already tracked, skipping`)
      return
    }

    const credential = await this.terminalDbService.findOne({ traderId: trader.traderId, cardId })
    if (!credential?.cred3 || getBankProvider(credential.cred3) === null) {
      this.logger.warn(
        `No valid bank URL (cred3) found for trader ${trader.traderId}, card_id ${cardId}. Order ${orderId} skipped.`
      )
      return
    }

    await this.enqueueOrderForPolling(
      trader,
      orderId,
      orderStringId,
      amount,
      credential.cred3,
      credential.terminalId,
      cardId
    )
  }

  /**
   * Enqueues an order for Monobank balance polling per JAR.
   */
  async enqueueOrderForPolling(
    trader: Trader,
    orderId: number,
    orderStringId: string,
    amount: number,
    targetUrl: string,
    terminalId: number,
    cardId: number,
    deferLog = false
  ): Promise<void> {
    // Track order to prevent duplicates
    const amountInKopecks = Math.round(amount * 100)
    await this.trackedOrderDbService.track(
      orderId,
      orderStringId,
      trader.traderId,
      cardId,
      amountInKopecks
    )

    const targetId = extractTargetId(targetUrl)
    if (!targetId) {
      this.logger.error(`Could not extract targetId from URL: ${targetUrl} for order ${orderId}`)
      return
    }

    let currentBalance = 0
    let baselineValue = 0
    const currentState = await this.terminalStateCacheService.getCurrentState(terminalId)
    const baseline = await this.terminalStateCacheService.getBaseline(terminalId)
    if (baseline !== null) {
      baselineValue = baseline
    }

    if (currentState) {
      currentBalance = currentState.current
    } else {
      currentBalance = baselineValue
    }

    const jobData: ScraperJobData = {
      terminalId,
      targetId,
      targetUrl,
      apiToken: trader.apiToken,
      traderId: trader.traderId,
      cardId
    }

    // Only start a new polling loop if one isn't already running
    const loopKey = RedisKeys.Terminal.loopActive(terminalId)
    const isLoopActive = await this.redis.get(loopKey)

    if (isLoopActive) {
      this.logger.log(
        `Polling loop already active for terminal ${terminalId}. Order ${orderId} will be picked up.`
      )
    } else {
      await this.redis.set(loopKey, '1', 'EX', 15) // Loop lease (15s)

      await this.monoQueue.add(`terminal-${terminalId}`, jobData, {
        jobId: `terminal-${terminalId}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 100
      })

      this.logger.log(
        `Started new polling loop for terminal ${terminalId}. Enqueued order ${orderId}.`
      )
    }
  }

  /**
   * An order Transacto says is paid — typically an operator confirming it in
   * their panel because the jar page was slow and the deadline was close.
   *
   * **Removing it from the pending pool is only half the job, and the other
   * half cost 606 UAH to learn.** The hryvnia that paid for this order are in
   * the jar; if nothing accounts for them, the next scrape reads them as an
   * unexplained delta and offers them to whatever orders are pending by then.
   * On 2026-09-08 two orders were confirmed here, their 611 UAH stayed
   * unaccounted, the jar page then caught up with a 919 UAH jump, and fuzzy
   * matching spent that same money a second time on two *different* orders —
   * releasing a user's USDT for payments nobody had made.
   *
   * So the baseline advances by this order's amount, which is what the matcher
   * would have done had it seen the money itself.
   */
  async handleOrderPaid(trader: Trader, order: TransactoWebhookOrder): Promise<void> {
    const { id: orderId } = order

    // Read before settling. `markCompleted` is the gate that decides whether
    // this path owns the order at all, and the amount has to come from what we
    // tracked rather than from the webhook: ours is in kopecks and is the
    // figure every other part of the ledger uses.
    const tracked = await this.trackedOrderDbService.findByOrderId(orderId)

    // **Most `order.paid` deliveries are this process hearing itself.**
    // Transacto fires the webhook the instant `orders_execute` succeeds, so an
    // order the matcher just executed comes straight back — often before the
    // matcher has finished writing its own reason, which is how every automatic
    // match came to be recorded as `ADMIN_PANEL` and shown to users as
    // "confirmed manually". Worse, the accounting below then ran for money that
    // had not arrived yet and pushed the baseline above the real balance.
    //
    // Left entirely to the matcher, which knows why it executed and will set
    // the baseline from the balance it actually read.
    if (this.isOurOwnEcho(tracked)) {
      this.logger.debug(
        `Order ${orderId}: order.paid is Transacto echoing our own execution; ` +
          'the path that executed it records it.'
      )

      return
    }

    const updated = await this.trackedOrderDbService.markCompleted(
      orderId,
      OrderStatus.EXECUTED,
      OrderExecutionReason.ADMIN_PANEL
    )

    if (!updated) {
      // Two very different things used to share this line at `debug`. "We
      // already settled it" is routine; "we have never heard of it" means the
      // `order.created` webhook never landed, and the order was never polled —
      // which is worth seeing, not burying.
      await this.reportUnsettled(orderId, 'paid')

      return
    }

    this.logger.log(`Order ${orderId} manually paid from webhook. Removed from pending pool.`)

    // Only on the branch that settled it here. When the matcher got there
    // first it has already set the baseline to the balance it actually read,
    // and adding to that would account for the same money twice — the mistake
    // this method exists to stop, made from the other direction.
    await this.accountForPayment(trader, orderId, tracked)
  }

  /**
   * Whether this `order.paid` is Transacto echoing an execution we asked for.
   *
   * A time window rather than the flag alone, because the flag is durable and
   * the echo is not: an order this process tried to execute and failed keeps
   * its marker, and an operator confirming that same order an hour later is a
   * genuine manual confirmation which must still be accounted for. Two minutes
   * is far longer than the echo has ever taken — it arrives within a second —
   * and far shorter than a person noticing and acting.
   */
  private isOurOwnEcho(tracked: TrackedOrder | null): boolean {
    const startedAt = tracked?.executionStartedAt

    if (startedAt === undefined || startedAt === null) return false

    return Date.now() - new Date(startedAt).getTime() <= SELF_EXECUTION_ECHO_MS
  }

  /**
   * Advances the jar baseline for an order settled without the jar being read.
   *
   * Every way of failing here is a log line and never a throw: the order is
   * already settled by the time this runs, and a webhook that answered non-2xx
   * would be redelivered and settle it again. What is lost is the accounting,
   * which is worth an operator's attention and not a retry storm.
   */
  private async accountForPayment(
    trader: Trader,
    orderId: number,
    tracked: TrackedOrder | null
  ): Promise<void> {
    if (tracked === null) {
      this.logger.warn(
        `Order ${orderId} was paid from the panel and is not tracked here, so its money ` +
          'cannot be accounted for. The next jar reading will report it as an unexplained deposit.'
      )

      return
    }

    const terminal = await this.terminalDbService.findOne({
      traderId: trader.traderId,
      cardId: tracked.cardId
    })

    if (!terminal) {
      this.logger.warn(
        `Order ${orderId} was paid from the panel and card ${tracked.cardId} belongs to no ` +
          `terminal of trader ${trader.traderId}; its ${tracked.amount} kopecks stay unaccounted.`
      )

      return
    }

    const baseline = await this.terminalStateCacheService.advanceBaseline(
      terminal.terminalId,
      tracked.amount
    )

    if (baseline === null) {
      // No baseline means no scrape loop, so there is no delta for this money
      // to be double-spent from and nothing to correct.
      this.logger.log(
        `Order ${orderId} was paid from the panel before terminal ${terminal.terminalId} had a ` +
          'baseline; nothing to advance.'
      )

      return
    }

    this.logger.log(
      `Order ${orderId} was paid from the panel: accounted for its ${tracked.amount} kopecks by ` +
        `advancing terminal ${terminal.terminalId}'s baseline to ${baseline}.`
    )
  }

  /**
   * Handles order.cancelled webhook.
   */
  async handleOrderCancelled(trader: Trader, order: TransactoWebhookOrder): Promise<void> {
    const updated = await this.trackedOrderDbService.markCompleted(order.id, OrderStatus.CANCELLED)

    if (updated) {
      this.logger.log(`Order ${order.id} cancelled from webhook. Removed from pending pool.`)
    } else {
      await this.reportUnsettled(order.id, 'cancelled')
    }
  }

  /**
   * Enqueue an order from the fallback cron sync.
   */
  async enqueueOrderFromFallback(
    trader: Trader,
    order: Order,
    deferLog = false
  ): Promise<TerminalHistoryOrderEvent | null> {
    const alreadyTracked = await this.trackedOrderDbService.isTracked(order.id)
    if (alreadyTracked) return null

    const cardId = order.card_id
    if (!cardId) {
      this.logger.debug(`Fallback: Order ${order.id} has no card_id, skipping`)
      return null
    }

    const credential = await this.terminalDbService.findOne({ traderId: trader.traderId, cardId })
    if (!credential?.cred3) {
      this.logger.debug(
        `Fallback: No cred3 for trader ${trader.traderId}, card_id ${cardId}. Order ${order.id} skipped.`
      )
      return null
    }

    await this.enqueueOrderForPolling(
      trader,
      order.id,
      order.order_id,
      order.amount,
      credential.cred3,
      credential.terminalId,
      cardId
    )

    return {
      orderId: order.id,
      amount: Math.round(order.amount * 100),
      status: OrderStatus.PENDING
    }
  }

  /**
   * Says why a webhook for an order changed nothing.
   *
   * `markCompleted` returns false for two opposite reasons, and they used to
   * share one `debug` line: the order was already in that state, which is
   * routine, or **we have never seen it at all**, which means its
   * `order.created` webhook never landed and it was never polled. The second is
   * a hole in the pipeline and belongs at `warn`.
   */
  private async reportUnsettled(orderId: number, event: string): Promise<void> {
    const known = await this.trackedOrderDbService.findByOrderId(orderId)

    if (!known) {
      this.logger.warn(
        `Webhook says order ${orderId} was ${event}, but it was never tracked here — ` +
          `its order.created event did not land, so nothing was ever polled for it.`
      )
      return
    }

    this.logger.debug(
      `Order ${orderId} is already ${known.status}; the ${event} webhook changes nothing.`
    )
  }
}
