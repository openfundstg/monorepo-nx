import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { QueryFilter, Model, Types } from 'mongoose'
import { Order, OrderDocument, OrderStatus, OrderExecutionReason } from '../schemas'
import { TransactoOrderStatus } from 'src/shared/interfaces'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

@Injectable()
export class OrderDbService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Was a `post('save')` / `post('findOneAndUpdate')` schema hook. Moved here so
   * the schema stays pure persistence and the emission is visible at the call
   * sites that cause it.
   *
   * `updateMany` never fired the old hook, so `failPendingOrdersForCard` still
   * does not emit — that preserves existing behaviour.
   *
   * The `order` MUST be a plain object. Spreading a hydrated Mongoose document
   * yields `{ $__, _doc }` and nothing else, so every consumer downstream read
   * `undefined` for status, amount and orderId while `cardId` — accessed
   * directly rather than spread — still looked fine. Every caller therefore
   * queries with `.lean()`.
   */
  private emitStateChanged(order: Order | null | undefined): void {
    if (!order) return

    const isRelevant =
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.CANCELLED ||
      order.executionReason === OrderExecutionReason.ADMIN_PANEL

    if (!isRelevant) return

    this.eventEmitter.emit('terminal.state_changed', {
      cardId: order.cardId,
      context: { orderEvents: [{ ...order }] }
    })

    // A second, narrower event, for the money the dashboard shows as pending.
    //
    // `terminal.state_changed` writes a history row and nothing else, and the
    // history feed is read by one page in the extension — not by the terminal
    // cards. So an order arriving or being cancelled over a webhook changed
    // nothing the trader could see on the dashboard: `pendingOrdersSum` reaches
    // it only through TERMINAL_BALANCE_UPDATED, which until now was emitted
    // exclusively by the scraper.
    //
    // That made the pending figure a side effect of polling. `order.created`
    // reached it late, because it had to wait for the loop to come round;
    // `order.cancelled` reached it later still, since nothing kicks the loop
    // for a cancellation and the loop throttles to 10s once no orders are
    // pending; and when the loop was not running at all — terminal disabled,
    // bank erroring, polling stopped after a fraud check — it never reached it.
    //
    // Kept separate from `terminal.state_changed` rather than folded into it
    // because the two have genuinely different consumers and different
    // correctness requirements: one writes a durable audit row, this one only
    // refreshes a number on screen and must never be able to fail the write.
    this.eventEmitter.emit('terminal.orders_changed', { cardId: order.cardId })
  }

  /** The stored order, whatever state it is in, or `null` if we never saw it. */
  async findByOrderId(orderId: number): Promise<Order | null> {
    return this.orderModel.findOne({ orderId }).lean()
  }

  /**
   * Whether re-enqueueing this order would be wrong.
   *
   * PENDING and PAUSED are the states we are actively polling. **EXECUTED is
   * here too**, and its absence was a live bug: `track()` upserts with
   * `status: PENDING` unconditionally, so any caller that asked this first and
   * got `false` would resurrect a settled order back into the polling queue.
   *
   * That happens on a timer. `orders_list` keeps reporting an order as
   * `status_id === 2` until Transacto's own state catches up — which, for an
   * order refused with 108, is *never* until a human confirms it — and the
   * 30-second sync re-enqueued it on every pass, re-matched it, and asked
   * Transacto to execute it again.
   *
   * CANCELLED is deliberately still absent. The stale-order check closes orders
   * that merely fell out of the top 100, and an order that later reappears
   * upstream must be allowed back into polling rather than staying wrongly dead.
   */
  async isTracked(orderId: number): Promise<boolean> {
    const doc = await this.orderModel.findOne({ orderId }).lean()
    if (!doc) return false

    const enqueuedStates = [OrderStatus.PENDING, OrderStatus.PAUSED, OrderStatus.EXECUTED]

    return enqueuedStates.includes(doc.status)
  }

  /**
   * Orders credited locally that Transacto never confirmed, oldest first.
   *
   * Bounded by attempts rather than by age: the trader limit that refused them
   * resets on its own schedule, and an order is worth one more ask until we
   * have clearly established nobody is going to accept it.
   */
  async findAwaitingUpstreamConfirmation(maxAttempts: number): Promise<Order[]> {
    return this.orderModel
      .find({
        status: OrderStatus.EXECUTED,
        awaitingUpstreamConfirmation: true,
        upstreamConfirmationAttempts: { $lt: maxAttempts }
      })
      .sort({ _id: 1 })
      .lean()
  }

  /** Flags an order as credited here but still open on Transacto. */
  /**
   * Records that this process is about to ask Transacto to execute an order.
   *
   * Called immediately before `orders_execute`, by every path that executes
   * one. What it buys is the ability to tell Transacto's `order.paid` echo of
   * *our own* call from an operator confirming a payment by hand — see
   * {@link Order.executionStartedAt}.
   */
  async markExecutionStarted(orderId: number): Promise<void> {
    await this.orderModel.updateOne({ orderId }, { $set: { executionStartedAt: new Date() } })
  }

  async markAwaitingUpstreamConfirmation(orderId: number): Promise<void> {
    await this.orderModel.updateOne({ orderId }, { $set: { awaitingUpstreamConfirmation: true } })
  }

  /** Records one more unsuccessful ask, so the retry eventually gives up. */
  async recordUpstreamConfirmationAttempt(orderId: number): Promise<void> {
    await this.orderModel.updateOne({ orderId }, { $inc: { upstreamConfirmationAttempts: 1 } })
  }

  /** Transacto finally accepted it; nothing is outstanding any more. */
  async markUpstreamConfirmed(orderId: number): Promise<void> {
    await this.orderModel.updateOne({ orderId }, { $set: { awaitingUpstreamConfirmation: false } })
  }

  async track(
    orderId: number,
    orderStringId: string,
    traderId: number,
    cardId: number,
    amount: number
  ): Promise<Order> {
    const order = await this.orderModel
      .findOneAndUpdate(
        { orderId },
        {
          orderId,
          orderStringId,
          traderId,
          cardId,
          amount,
          enqueuedAt: new Date(),
          lastSyncAt: new Date(),
          status: OrderStatus.PENDING
        },
        { upsert: true, returnDocument: 'after' }
      )
      .lean()

    this.emitStateChanged(order)
    return order
  }

  /**
   * The most recent orders on a card, newest first.
   *
   * Read by the Mini App's abuse check, which asks whether the last few orders
   * in a row all went nowhere. Sorted by `_id` rather than a timestamp because
   * it is monotonic per insert and needs no extra index — and unlike
   * `enqueuedAt` it cannot tie, which would make "the last three" ambiguous.
   */
  async findRecentByCard(cardId: number, limit: number): Promise<Order[]> {
    return this.orderModel.find({ cardId }).sort({ _id: -1 }).limit(limit).lean()
  }

  /**
   * Orders on a card that have not reached a final state.
   *
   * Read before a sale may be stopped early. PENDING means a payer can
   * still complete; PAUSED is suspended rather than closed and can come back to
   * life *after* we would have released the stake; APPEAL is money actively in
   * dispute. Any of the three means the terminal is not finished with.
   */
  async findUnsettledByCard(cardId: number): Promise<Order[]> {
    return this.orderModel
      .find({
        cardId,
        status: { $in: [OrderStatus.PENDING, OrderStatus.PAUSED, OrderStatus.APPEAL] }
      })
      .lean()
  }

  async getPendingOrdersForCard(cardId: number): Promise<Order[]> {
    return this.orderModel.find({ cardId, status: OrderStatus.PENDING }).lean()
  }

  /**
   * Pending orders across several cards at once.
   *
   * The terminal search reports a pending total per row, and asking per card
   * turned one search into a query per result. One `$in` covers the page.
   */
  async getPendingOrdersForCards(cardIds: readonly number[]): Promise<Order[]> {
    if (!cardIds.length) return []

    return this.orderModel.find({ cardId: { $in: cardIds }, status: OrderStatus.PENDING }).lean()
  }

  async getPendingOrdersForTrader(traderId: number): Promise<Order[]> {
    return this.orderModel.find({ traderId, status: OrderStatus.PENDING }).lean()
  }

  async failPendingOrdersForCard(cardId: number): Promise<void> {
    await this.orderModel.updateMany(
      { cardId, status: OrderStatus.PENDING },
      { $set: { status: OrderStatus.PAUSED } }
    )
  }

  async markCompleted(
    orderId: number,
    status: OrderStatus,
    executionReason?: OrderExecutionReason,
    actualAmount?: number
  ): Promise<boolean> {
    const update: Partial<Order> = { status }
    if (status === OrderStatus.EXECUTED) {
      update.executedAt = new Date()
    }
    if (executionReason !== undefined) {
      update.executionReason = executionReason
    }
    if (actualAmount !== undefined) {
      update.actualAmount = actualAmount
    }
    const doc = await this.orderModel
      .findOneAndUpdate(
        { orderId, status: { $ne: status } },
        { $set: update },
        {
          returnDocument: 'after'
        }
      )
      .lean()

    // The old hook only fired when the update touched status or executionReason,
    // which is exactly what this method always does.
    this.emitStateChanged(doc)

    return !!doc
  }
  async updateFromTransacto(
    orderId: number,
    transactoStatus: number
  ): Promise<{
    changed: boolean
    order?: Order
    oldStatus?: OrderStatus
    newStatus?: OrderStatus
  }> {
    const doc = await this.orderModel.findOne({ orderId }).lean()
    if (!doc) return { changed: false }

    const update: Partial<Order> = { lastSyncAt: new Date() }
    let changed = false
    let newStatus: OrderStatus = doc.status
    let newReason = doc.executionReason

    if (doc.status === OrderStatus.PENDING || doc.status === OrderStatus.PAUSED) {
      if (
        transactoStatus === TransactoOrderStatus.NEW ||
        transactoStatus === TransactoOrderStatus.WAITING_PAYMENT
      ) {
        newStatus = OrderStatus.PENDING
      } else if (
        transactoStatus === TransactoOrderStatus.CLIENT_PAID ||
        transactoStatus === TransactoOrderStatus.EXECUTED
      ) {
        newStatus = OrderStatus.EXECUTED
        newReason = OrderExecutionReason.ADMIN_PANEL
      } else if (
        [
          TransactoOrderStatus.CLIENT_CANCELLED,
          TransactoOrderStatus.DECLINED,
          TransactoOrderStatus.EXPIRED_HOLD,
          TransactoOrderStatus.OVERDUE,
          TransactoOrderStatus.ERRONEOUS,
          TransactoOrderStatus.FRAUD,
          TransactoOrderStatus.TRADER_ERROR
        ].includes(transactoStatus)
      ) {
        newStatus = OrderStatus.CANCELLED
      } else if (transactoStatus === TransactoOrderStatus.APPEAL) {
        newStatus = OrderStatus.APPEAL
      }

      if (newStatus !== doc.status) {
        update.status = newStatus
        if (newStatus === OrderStatus.EXECUTED) update.executedAt = new Date()
        changed = true
      }
      if (newReason && newReason !== doc.executionReason) {
        update.executionReason = newReason
      }
    }

    if (changed || update.lastSyncAt) {
      const updated = await this.orderModel
        .findOneAndUpdate({ orderId }, { $set: update }, { returnDocument: 'after' })
        .lean()

      // The old hook returned early unless the update touched status or
      // executionReason, so only emit when one of them actually changed.
      if (update.status !== undefined || update.executionReason !== undefined) {
        this.emitStateChanged(updated)
      }
    }

    return {
      changed,
      order: doc as Order,
      oldStatus: doc.status,
      newStatus
    }
  }

  /**
   * UAH kopecks of orders Transacto has confirmed since a moment, per card.
   *
   * Confirmed means EXECUTED **and** not still awaiting Transacto: an order the
   * matcher settled whose `orders_execute` answered 108 is ours alone until
   * the retry or a human closes it upstream, and counting it would report money
   * Transacto has not agreed to.
   *
   * `amount`, not `actualAmount`: `orders_execute` sends no figure, so what
   * Transacto confirms is the order as it issued it. Grouped by card rather than
   * summed, because which cards count is the caller's question — this
   * collection does not know which terminals are the Mini App's.
   */
  async sumConfirmedByCardSince(since: Date): Promise<{ cardId: number; volume: number }[]> {
    return this.orderModel
      .aggregate<{ cardId: number; volume: number }>([
        {
          $match: {
            status: OrderStatus.EXECUTED,
            awaitingUpstreamConfirmation: { $ne: true },
            // `createdAt` for orders settled before `executedAt` existed.
            $expr: { $gte: [{ $ifNull: ['$executedAt', '$createdAt'] }, since] }
          }
        },
        { $group: { _id: '$cardId', volume: { $sum: '$amount' } } },
        { $project: { _id: 0, cardId: '$_id', volume: 1 } }
      ])
      .exec()
  }

  /** One page of orders across every trader — the admin panel's only read here. */
  async findPage(
    filter: QueryFilter<Order>,
    page: PageQuery
  ): Promise<Page<Order & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.orderModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.orderModel.countDocuments(filter)
    ])

    return { items, total }
  }
}
