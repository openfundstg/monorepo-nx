import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TraderDbService } from 'src/modules/repositories/trader-db'
import { OrderExecutionOutcome, TransactoApiService } from 'src/modules/transacto'
import { OrderPollingService } from 'src/modules/order-polling/services/order-polling.service'
import { OrderDbService, OrderStatus } from 'src/modules/repositories/order-db'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import {
  describeErrors,
  settleStaggered,
  TRADER_REQUEST_STAGGER_MS
} from 'src/shared/utils'
import { TerminalHistoryOrderEvent } from 'src/modules/repositories/terminal-history-db/schemas'

/**
 * How many times a locally-credited order is re-offered to Transacto before the
 * retry gives up on it.
 *
 * The limit that refused it resets on Transacto's own schedule, so asking again
 * is usually all it takes — but an order nobody ever intends to confirm must
 * not cost a request forever. Giving up stops the asking, not the alert: the
 * confirmation is still outstanding and the trader still sees it.
 */
const MAX_UPSTREAM_CONFIRMATION_ATTEMPTS = 20

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name)
  private isSyncing = false
  private isCheckingStale = false
  private isRetryingConfirmations = false

  constructor(
    private readonly traderDbService: TraderDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly orderPollingService: OrderPollingService,
    private readonly orderDbService: OrderDbService,
    private readonly alertsService: AlertsService
  ) {}

  /**
   * Cron job: every 30 seconds, poll orders_list (limit=100)
   * for all active traders to sync statuses and enqueue new orders.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async syncPendingOrders(): Promise<void> {
    if (this.isSyncing) {
      this.logger.debug('Order sync already in progress, skipping')
      return
    }

    this.isSyncing = true
    try {
      const traders = await this.traderDbService.findAllActive()
      if (traders.length === 0) return

      this.logger.log(`Polling orders for ${traders.length} active trader(s)`)

      // Started 50ms apart — see `settleStaggered`. This cron and the terminals
      // sync land on the same second, so without it four calls hit Transacto at
      // once every minute.
      const results = await settleStaggered(
        traders,
        TRADER_REQUEST_STAGGER_MS,
        async (trader) => {
          // Fetch the latest 100 orders regardless of status
          const orders = await this.transactoApiService.getOrdersList(
            trader.apiToken,
            undefined, // No status filter
            100
          )

          let syncedCount = 0

          for (const order of orders) {
            // Update local DB status if order is tracked
            await this.orderDbService.updateFromTransacto(order.id, order.status_id)

            if (order.status_id === 2) {
              await this.orderPollingService.enqueueOrderFromFallback(trader, order)
            }
            syncedCount++
          }

          if (orders.length > 0) {
            this.logger.debug(
              `Trader ${trader.traderId}: fetched ${orders.length} orders, synced ${syncedCount}`
            )
          }
        }
      )

      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        // Summarised rather than dumped — see `describeErrors`. A raw
        // AxiosError here would print the trader's `X-API-TOKEN`.
        this.logger.error(
          `Order sync failed for ${failed.length}/${traders.length} trader(s): ` +
            describeErrors(failed.map((r) => (r as PromiseRejectedResult).reason))
        )
      }
    } catch (error) {
      this.logger.error(
        'Order sync cron failed',
        error instanceof Error ? error.stack : String(error)
      )
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Cron job: every 10 minutes, check for orders that are still PENDING locally,
   * but haven't been updated from Transacto for over 10 minutes (meaning they fell out of the top 100).
   */
  @Cron('0 */10 * * * *')
  async checkStaleOrders(): Promise<void> {
    if (this.isCheckingStale) {
      return
    }

    this.isCheckingStale = true
    try {
      const traders = await this.traderDbService.findAllActive()

      for (const trader of traders) {
        // Find all pending orders for this trader
        const pendingOrders = await this.orderDbService.getPendingOrdersForTrader(trader.traderId)

        // Filter those whose lastSyncAt is older than 10 minutes
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
        const staleOrders = pendingOrders.filter((o) => new Date(o.lastSyncAt) < tenMinutesAgo)

        if (staleOrders.length === 0) continue

        this.logger.log(
          `Trader ${trader.traderId}: Found ${staleOrders.length} stale PENDING orders. Checking specific cards.`
        )

        // Extract unique cardIds
        const cardIds = Array.from(new Set(staleOrders.map((o) => o.cardId)))

        // Fetch up to 100 orders for these specific cards
        const orders = await this.transactoApiService.getOrdersList(
          trader.apiToken,
          undefined,
          100,
          cardIds
        )

        for (const order of orders) {
          await this.orderDbService.updateFromTransacto(order.id, order.status_id)
        }

        // Now, re-evaluate the stale orders. If their lastSyncAt is still older than 10 minutes,
        // it means Transacto didn't return them even when filtered by card! They must be cancelled.
        for (const staleOrder of staleOrders) {
          const isStillStale = await this.orderDbService.isTracked(staleOrder.orderId) // checking existence
          if (!isStillStale) continue

          const updatedDoc = await this.orderDbService
            .getPendingOrdersForTrader(trader.traderId)
            .then((res) => res.find((r) => r.orderId === staleOrder.orderId))

          if (updatedDoc && new Date(updatedDoc.lastSyncAt) < tenMinutesAgo) {
            this.logger.log(
              `Order ${staleOrder.orderId} was not found on Transacto list. Marking as CANCELLED.`
            )
            await this.orderDbService.markCompleted(staleOrder.orderId, OrderStatus.CANCELLED)
          }
        }
      }
    } catch (error) {
      this.logger.error(
        'Stale order check cron failed',
        error instanceof Error ? error.stack : String(error)
      )
    } finally {
      this.isCheckingStale = false
    }
  }

  /**
   * Re-offers orders that were credited here but refused upstream with 108.
   *
   * "Insufficient trader limit" is a temporary condition — the limit resets —
   * so most of these clear themselves without the trader touching anything.
   * The alert stands until one of them succeeds, because until then the order
   * really is unconfirmed in the cabinet.
   *
   * Every five minutes rather than on the 30-second sync: nothing here is
   * urgent, and a limit that just refused an order will not have reset a few
   * seconds later.
   */
  @Cron('0 */5 * * * *')
  async retryUpstreamConfirmations(): Promise<void> {
    if (this.isRetryingConfirmations) return

    this.isRetryingConfirmations = true
    try {
      const pending = await this.orderDbService.findAwaitingUpstreamConfirmation(
        MAX_UPSTREAM_CONFIRMATION_ATTEMPTS
      )
      if (pending.length === 0) return

      const traders = await this.traderDbService.findAllActive()
      const tokenByTraderId = new Map(traders.map((trader) => [trader.traderId, trader.apiToken]))

      this.logger.log(`Retrying ${pending.length} unconfirmed order(s) on Transacto`)

      for (const order of pending) {
        const apiToken = tokenByTraderId.get(order.traderId)
        // A deactivated trader has no token to ask with. Left flagged rather
        // than counted as an attempt, so it resumes if they are reactivated.
        if (!apiToken) continue

        await this.retryOne(order.orderId, apiToken)
      }
    } catch (error) {
      this.logger.error(
        'Upstream confirmation retry cron failed',
        error instanceof Error ? error.stack : String(error)
      )
    } finally {
      this.isRetryingConfirmations = false
    }
  }

  /**
   * One order, one ask. Never throws — a trader whose retry fails must not stop
   * the others being tried.
   */
  private async retryOne(orderId: number, apiToken: string): Promise<void> {
    try {
      // See `Order.executionStartedAt`: their `order.paid` echo must not be
      // mistaken for an operator's own confirmation.
      await this.orderDbService.markExecutionStarted(orderId)

      const confirmation = await this.transactoApiService.executeOrder(apiToken, orderId)

      if (confirmation.outcome !== OrderExecutionOutcome.CONFIRMED) {
        await this.orderDbService.recordUpstreamConfirmationAttempt(orderId)
        return
      }

      await this.orderDbService.markUpstreamConfirmed(orderId)
      await this.alertsService.resolveOrderConfirmationAlert(orderId)
      this.logger.log(`Order ${orderId} confirmed on Transacto by retry; alert resolved`)
    } catch (error: unknown) {
      await this.orderDbService.recordUpstreamConfirmationAttempt(orderId)
      this.logger.warn(
        `Retry of order ${orderId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}
