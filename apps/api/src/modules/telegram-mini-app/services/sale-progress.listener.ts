import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  SaleEventType,
  SaleMethod,
  TerminalSource,
  WsEventNames
} from '@transacto/contracts'
import type { TerminalBalanceUpdatedDto } from '@transacto/contracts'
import { classifyTerminalSource } from 'src/shared/utils'
import { OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleComplianceService } from 'src/modules/telegram-mini-app/services/sale-compliance.service'
import { SaleSettlementService } from 'src/modules/telegram-mini-app/services/sale-settlement.service'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import {
  TERMINAL_ORDERS_EXECUTED,
  TraderWsEvent,
  TerminalOrdersExecutedEvent
} from 'src/shared/interfaces'

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
    private readonly orderDbService: OrderDbService,
    private readonly settlement: SaleSettlementService,
    private readonly cardOrders: SaleCardOrderService
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
      if (await this.settlement.settleIfFinished(saleId, latest)) return

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
          const credited = await this.settlement.creditSettledOrder(saleId, orderEvent)
          if (credited) latest = credited

          // A card sale's order was answered by somebody other than its seller
          // — an operator, in Transacto's panel. Closing the question here is
          // what stops the sweep disputing an order that is already paid and
          // stopping a terminal with nothing wrong with it.
          if (latest.saleMethod === SaleMethod.CARD && typeof orderEvent.orderId === 'number') {
            const closed = await this.cardOrders.markSettledUpstream(latest, orderEvent.orderId)
            if (closed) latest = closed
          }
          continue
        }

        const type =
          orderEvent.status === OrderStatus.CANCELLED
            ? SaleEventType.ORDER_CANCELLED
            : SaleEventType.ORDER_RECEIVED

        // A cancelled order is not progress, so it must not move the order into
        // AWAITING_FIAT — only an incoming one does.
        if (type === SaleEventType.ORDER_RECEIVED) {
          await this.saleDbService.markAwaitingFiat(saleId)

          // On a card sale the arrival is also a question put to a person: no
          // scraper will ever see this money, so the seller has to say whether
          // it came. `recordArrival` is idempotent, and it is what puts the
          // order on the sale's screen and in front of the bot.
          if (latest.saleMethod === SaleMethod.CARD && typeof orderEvent.orderId === 'number') {
            const recorded = await this.cardOrders.recordArrival(latest, {
              orderId: orderEvent.orderId,
              amount: orderEvent.amount ?? 0
            })
            if (recorded) latest = recorded
          }
        }

        const appended = await this.saleDbService.appendEvent(saleId, {
          type,
          amount: orderEvent.amount,
          orderId: orderEvent.orderId,
          at: Date.now()
        })
        if (appended) latest = appended
      }

      if (await this.settlement.settleIfFinished(saleId, latest)) return

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
        const credited = await this.settlement.creditSettledOrder(saleId, executed)
        if (credited) latest = credited
      }

      if (await this.settlement.settleIfFinished(saleId, latest)) return

      await this.progressService.emit(latest)
    } catch (error) {
      this.warn('executed orders', error)
    }
  }

  private warn(context: string, error: unknown): void {
    this.logger.error(
      `Mini App progress handling failed for ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
