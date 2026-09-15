import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  SaleEventType,
  SaleRemainderPolicy,
  TerminalSource,
  WsEventNames
} from '@transacto/contracts'
import type { TerminalBalanceUpdatedDto } from '@transacto/contracts'
import {
  classifyTerminalSource,
  isRemainderRefundable,
  isSaleFunded,
  parseMinOrderKopecks
} from 'src/shared/utils'
import environments from 'src/environments'
import { OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleComplianceService } from 'src/modules/telegram-mini-app/services/sale-compliance.service'
import {
  TERMINAL_ORDERS_EXECUTED,
  TraderWsEvent,
  TerminalOrdersExecutedEvent
} from 'src/shared/interfaces'

/**
 * The fields the settlement decision is made on.
 *
 * Widened past `{ receivedAmount, fiatAmount, jarBalance }` because the
 * remainder rule needs three more: the opening balance the delivered figure is
 * measured from, the policy the order was created under, and the card, so
 * anything still in flight on it can be checked before a tail is written off.
 */
interface SettleableOrder {
  receivedAmount: number
  fiatAmount: number
  jarBalance?: number | null
  openingJarBalance?: number | null
  remainderPolicy?: SaleRemainderPolicy | null
  cardId?: number | null
}

/** Payload of the in-process `terminal.state_changed` channel. */
interface TerminalStateChangedEvent {
  cardId?: number
  terminalId?: number
  context?: {
    orderEvents?: Array<{
      orderId?: number
      amount?: number
      status?: OrderStatus
      executionReason?: OrderExecutionReason
    }>
  }
}

/**
 * Turns trader-side pipeline events into Mini App progress.
 *
 * This is the bridge that did not exist. Every signal about money — the bank
 * scrape, the order webhook, the matcher — knows a `cardId` and a `traderId`,
 * and neither of those says anything about a Telegram user. The only route back
 * is the sale itself, which records the `cardId` of the terminal it
 * created, so every handler here starts by resolving that.
 *
 * Listeners live apart from {@link SaleProgressService} so the facade can
 * emit progress without this class and this class can call the facade, with no
 * dependency cycle between them.
 *
 * Every handler is defensive to the point of silence: these fire on the hot
 * path of the scraper, and a Mini App bookkeeping failure must never take down
 * a scrape or a trader's order execution.
 */
@Injectable()
export class SaleProgressListener {
  private readonly logger = new Logger(SaleProgressListener.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly progressService: SaleProgressService,
    private readonly saleFacade: SaleFacadeService,
    private readonly compliance: SaleComplianceService,
    private readonly orderDbService: OrderDbService
  ) {}

  /**
   * The jar balance moved.
   *
   * Rides on the same `ws.emit` envelope the extension gateway consumes rather
   * than a new emit site, so there is exactly one place that decides a balance
   * is worth broadcasting — including its 15-second dedupe. Non-balance events
   * on the channel are ignored.
   */
  @OnEvent('ws.emit')
  async handleTraderWsEvent(event: TraderWsEvent<unknown>): Promise<void> {
    if (event?.event !== WsEventNames.TERMINAL_BALANCE_UPDATED) return

    const payload = event.data as TerminalBalanceUpdatedDto
    if (typeof payload?.cardId !== 'number') return

    // Cheap in-memory filter before touching Mongo.
    //
    // This channel carries a balance broadcast for EVERY terminal of every
    // trader, on a 15-second heartbeat that fires whether or not anything
    // changed. Querying for an owning sale on each one meant a database
    // round trip per terminal per heartbeat — for terminals that, in the
    // overwhelming majority, belong to extension traders and can never have a
    // sale at all. The name tells us for free: only Mini App terminals
    // carry the TMA prefix, which is the whole reason the prefix is a contract.
    if (classifyTerminalSource(payload.terminalName) !== TerminalSource.TMA) return

    try {
      const order = await this.saleDbService.findOpenByCardId(payload.cardId)
      if (!order) return

      const saleId = order._id.toString()

      // Recorded before anything is judged. What the jar holds is an
      // observation, not a verdict — every rule below is decided on it, so
      // writing it first is what lets them all read the same number.
      //
      // Returns null when the balance is unchanged, which is the common case on
      // the 15-second heartbeat: no write, and no push at the end.
      const updated = await this.saleDbService.updateJarBalance(
        saleId,
        payload.currentBalance
      )
      const latest = updated ?? { ...order, jarBalance: payload.currentBalance }

      // Funding is checked ahead of compliance, deliberately. An order whose
      // target has arrived is finished, and no rule about how it was set up is
      // worth stranding the payer's hryvnia and the user's stake over.
      //
      // This is also the only path that notices the last stretch arriving. The
      // tail is too small for Transacto to route an order for, so the user pays
      // it in themselves — which produces a balance change and nothing else.
      if (await this.settleIfFinished(saleId, latest)) return

      // This scrape carries both figures the two post-creation rules are judged
      // on — the jar's target and its balance — and a blocked order must not go
      // on collecting progress updates.
      if (await this.compliance.check(order, payload.goal, payload.currentBalance)) return

      if (!updated) return

      await this.progressService.emit(updated)
    } catch (error) {
      this.warn('balance update', error)
    }
  }

  /**
   * An order on the terminal changed state.
   *
   * `terminal.state_changed` fires for three cases, not two:
   * PENDING (someone is about to pay), CANCELLED (they are not any more), and
   * `executionReason === ADMIN_PANEL` — an order settled through the Transacto
   * panel or reported paid by the 30-second order sync, rather than matched by
   * the scraper.
   *
   * That third case is money actually arriving, and it is the ONLY notice of it
   * we get: an admin-settled order stops being PENDING, so the scraper's matcher
   * — which only ever looks at pending orders — can never match it and
   * `TERMINAL_ORDERS_EXECUTED` never fires for it. Treating it as merely
   * "an order was received" would leave `receivedAmount` at zero, the sale
   * stuck at AWAITING_FIAT forever, and the user's USDT frozen with no
   * path to release it.
   */
  @OnEvent('terminal.state_changed')
  async handleTerminalStateChanged(event: TerminalStateChangedEvent): Promise<void> {
    const orderEvents = event?.context?.orderEvents
    if (typeof event?.cardId !== 'number' || !orderEvents?.length) return

    try {
      const order = await this.saleDbService.findOpenByCardId(event.cardId)
      if (!order) return

      const saleId = order._id.toString()
      let latest = order

      for (const orderEvent of orderEvents) {
        const settledUpstream =
          orderEvent.status === OrderStatus.EXECUTED ||
          orderEvent.executionReason === OrderExecutionReason.ADMIN_PANEL

        if (settledUpstream) {
          // Credited through the deduplicating path, because the scraper may
          // also report this same order and only one of the two may count.
          const credited = await this.creditSettledOrder(saleId, orderEvent)
          if (credited) latest = credited
          continue
        }

        const type =
          orderEvent.status === OrderStatus.CANCELLED
            ? SaleEventType.ORDER_CANCELLED
            : SaleEventType.ORDER_RECEIVED

        // A cancelled order is not progress, so it must not move the order into
        // AWAITING_FIAT — only an incoming one does.
        if (type === SaleEventType.ORDER_RECEIVED)
          await this.saleDbService.markAwaitingFiat(saleId)

        const appended = await this.saleDbService.appendEvent(saleId, {
          type,
          amount: orderEvent.amount,
          orderId: orderEvent.orderId,
          at: Date.now()
        })
        if (appended) latest = appended
      }

      if (await this.settleIfFinished(saleId, latest)) return

      await this.progressService.emit(latest)
    } catch (error) {
      this.warn('terminal state change', error)
    }
  }

  /**
   * Money arrived and settled orders — the event the whole feature exists for.
   *
   * Completion is decided on the cumulative matched total rather than on the
   * jar balance, because the jar can hold money that no order accounts for (an
   * unrecognised deposit) and the baseline is reset after every match. What the
   * user was promised is that `fiatAmount` gets sold, and only executed
   * orders prove that.
   */
  @OnEvent(TERMINAL_ORDERS_EXECUTED)
  async handleOrdersExecuted(event: TerminalOrdersExecutedEvent): Promise<void> {
    if (typeof event?.cardId !== 'number' || !event.orders?.length) return

    try {
      const order = await this.saleDbService.findOpenByCardId(event.cardId)
      if (!order) return

      const saleId = order._id.toString()
      let latest = order

      for (const executed of event.orders) {
        const credited = await this.creditSettledOrder(saleId, executed)
        if (credited) latest = credited
      }

      if (await this.settleIfFinished(saleId, latest)) return

      await this.progressService.emit(latest)
    } catch (error) {
      this.warn('executed orders', error)
    }
  }

  /**
   * Credits one settled order, ignoring a repeat report of the same order id.
   *
   * Returns the updated document, or `null` when the order was already counted
   * or carried no usable amount — a state change with no numeric amount is a
   * status flip we cannot price, and guessing would corrupt the total.
   */
  private async creditSettledOrder(
    saleId: string,
    settled: { orderId?: number; amount?: number }
  ) {
    if (typeof settled.orderId !== 'number' || typeof settled.amount !== 'number') return null

    return this.saleDbService.creditExecutedOrder(
      saleId,
      settled.orderId,
      settled.amount,
      Date.now()
    )
  }

  /**
   * Closes the order once nothing more is coming — for either of two reasons.
   *
   * **Funded** is the ordinary one: the target has arrived, by matched orders or
   * by a trader's top-up. {@link isSaleFunded} is where the distinction
   * between matched money and money merely sitting in the jar is explained.
   *
   * **Refundable** is the new one, and only for an order created with
   * `REFUND_TO_BALANCE`: the gap left is smaller than any order the pipeline can
   * route, so it will never be filled by a payment. Rather than wait for someone
   * to pay it in by hand, the tail goes back to the user as USDT and the order
   * closes successfully. See {@link isRemainderRefundable}.
   *
   * Funded is checked first, deliberately. A jar that actually reached its
   * target settles as a full fill with no refund at all, whatever policy the
   * order carries — the two are not alternatives, and asking in the other order
   * would refund a tail that had already been paid.
   *
   * All three handlers come through here, so whichever signal notices first
   * closes the order. `completeSale` is idempotent and emits its own
   * progress snapshot, so a `true` return means the announcement is handled.
   */
  private async settleIfFinished(
    saleId: string,
    latest: SettleableOrder
  ): Promise<boolean> {
    const minOrderKopecks = this.minOrderKopecks()

    if (isSaleFunded(latest, minOrderKopecks))
      return this.saleFacade.completeSale(saleId)

    if (!isRemainderRefundable(latest, minOrderKopecks)) return false

    // Nothing may still be in flight.
    //
    // The arithmetic says no order this small can exist, so in principle there
    // is nothing to wait for. But an order raised while there *was* room and
    // still unsettled — one under appeal, above all — can resolve into money
    // later, and by then this order would be closed, its tail already refunded
    // and its terminal retired. The user would keep both. The same check the
    // cancellation path makes, for the same reason, and it costs one indexed
    // lookup at the one moment an order closes.
    if (latest.cardId !== null && latest.cardId !== undefined) {
      const unsettled = await this.orderDbService.findUnsettledByCard(latest.cardId)
      if (unsettled.length > 0) {
        this.logger.debug(
          `Sale ${saleId} has an unfillable tail but ${unsettled.length} ` +
            `order(s) are still open on card ${latest.cardId}; not refunding yet`
        )
        return false
      }
    }

    return this.saleFacade.completeSale(saleId)
  }

  /** The smallest order Transacto will route, and so the width of the tail. */
  private minOrderKopecks(): number {
    return parseMinOrderKopecks(environments.TRANSACTO_MIN_ORDER_KOPECKS)
  }

  private warn(context: string, error: unknown): void {
    this.logger.error(
      `Mini App progress handling failed for ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
