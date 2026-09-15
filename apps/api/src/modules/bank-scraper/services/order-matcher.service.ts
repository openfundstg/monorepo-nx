import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OrderExecutionOutcome, TransactoApiService } from 'src/modules/transacto'
import { OrderDbService, OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'
import { TerminalStateCacheService } from './terminal-state-cache.service'
import { SubsetSumMatcherService, MatchResultStatus } from './subset-sum-matcher.service'
import {
  TraderWsEvent,
  WsEventNames,
  TERMINAL_ORDERS_EXECUTED,
  TerminalOrdersExecutedEvent
} from 'src/shared/interfaces'
import { AlertType, AlertDocument } from 'src/modules/repositories/alerts-db/schemas'
import { isGoalClosingTopUp, parseMinOrderKopecks } from 'src/shared/utils'
import environments from 'src/environments'

import {
  TerminalHistoryOrderEvent,
  TerminalHistoryAlert,
  TerminalHistoryAlertType
} from 'src/modules/repositories/terminal-history-db/schemas'

export interface MatchingOutcome {
  baselineBalance: number
  historyOrderEvents: TerminalHistoryOrderEvent[]
  historyAlerts: TerminalHistoryAlert[]
}

@Injectable()
export class OrderMatcherService {
  private readonly logger = new Logger(OrderMatcherService.name)

  constructor(
    private readonly transactoApiService: TransactoApiService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly alertsService: AlertsService,
    private readonly terminalStateCache: TerminalStateCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly terminalBalanceOrchestratorService: TerminalBalanceOrchestratorService
  ) {}

  async processDelta(
    terminalId: number,
    traderId: number,
    cardId: number,
    terminalName: string,
    sendId: string,
    currentBalance: number,
    baselineBalance: number,
    totalDelta: number,
    apiToken: string,
    goal?: number
  ): Promise<MatchingOutcome> {
    const outcome: MatchingOutcome = {
      baselineBalance,
      historyOrderEvents: [],
      historyAlerts: []
    }

    const pendingOrders = await this.trackedOrderDbService.getPendingOrdersForCard(cardId)
    const matchResult = SubsetSumMatcherService.evaluateDelta(pendingOrders, totalDelta)

    switch (matchResult.status) {
      case MatchResultStatus.FUZZY_MATCH:
        for (const order of matchResult.matchedOrders) {
          this.logger.log(
            `Executing order ${order.orderId} (${order.orderStringId}) for ${order.amount} ` +
              `kopecks on card ${order.cardId} — FUZZY MATCH`
          )
          // Recorded before the call: Transacto fires `order.paid` the moment
          // `orders_execute` succeeds, and that echo can reach this process
          // before this very line returns. Without the marker it is
          // indistinguishable from an operator confirming by hand.
          await this.trackedOrderDbService.markExecutionStarted(order.orderId)

          const confirmation = await this.transactoApiService.executeOrder(apiToken, order.orderId)
          const settledHere = await this.trackedOrderDbService.markCompleted(
            order.orderId,
            OrderStatus.EXECUTED,
            OrderExecutionReason.FUZZY_MATCH,
            matchResult.amount
          )

          await this.handleUnconfirmed(traderId, terminalId, order, confirmation, outcome)

          // Same gate as the perfect branch below, for the same reason.
          if (settledHere) {
            outcome.historyOrderEvents.push({
              orderId: order.orderId,
              amount: order.amount,
              status: OrderStatus.EXECUTED,
              executionReason: OrderExecutionReason.FUZZY_MATCH
            })
          } else {
            this.logger.log(
              `Order ${order.orderId} (${order.orderStringId}) was already settled by another ` +
                `path; this fuzzy match adds no history entry.`
            )
          }
          this.logger.log(
            `✅ Order ${order.orderId} (${order.orderStringId}) fuzzy matched and executed.`
          )
        }

        // The money now accounted for is what is actually in the jar. Deriving
        // this from the matched delta instead let a phantom delta push the
        // baseline above the real balance, and the next scrape read that as a
        // withdrawal and disabled the terminal for fraud.
        outcome.baselineBalance = currentBalance
        await this.terminalStateCache.updateBaseline(terminalId, outcome.baselineBalance, {
          deferEvent: true
        })
        this.logger.log(
          `Updated baseline for terminal ${terminalId} to ${outcome.baselineBalance} after fuzzy match.`
        )

        await this.alertsService.resolvePendingAlertsForJar(terminalId)
        break

      case MatchResultStatus.PERFECT_MATCH:
        for (const order of matchResult.matchedOrders) {
          this.logger.log(
            `Executing order ${order.orderId} (${order.orderStringId}) for ${order.amount} ` +
              `kopecks on card ${order.cardId}`
          )
          // Recorded before the call: Transacto fires `order.paid` the moment
          // `orders_execute` succeeds, and that echo can reach this process
          // before this very line returns. Without the marker it is
          // indistinguishable from an operator confirming by hand.
          await this.trackedOrderDbService.markExecutionStarted(order.orderId)

          const confirmation = await this.transactoApiService.executeOrder(apiToken, order.orderId)

          // `FULL_MATCH` was missing here while the fuzzy branch above passed
          // its own reason, so a cleanly matched order was stored with an empty
          // `executionReason` — the label existed only on the history entry.
          const settledHere = await this.trackedOrderDbService.markCompleted(
            order.orderId,
            OrderStatus.EXECUTED,
            OrderExecutionReason.FULL_MATCH
          )

          await this.handleUnconfirmed(traderId, terminalId, order, confirmation, outcome)

          // Only the path that actually settled the order records it.
          //
          // `markCompleted` guards on `status: { $ne: status }`, so exactly one
          // caller gets a document back — it is already the gate that decides
          // this, and the answer was simply being discarded.
          //
          // The other caller is Transacto's own `order.paid` webhook, and it is
          // not an independent observation: it fires *because* of the
          // `orders_execute` call above, so it is our own action arriving back
          // over HTTP, and it lands in the window between that call returning
          // and this write finishing. `handleOrderPaid` settles the order as
          // ADMIN_PANEL, which `emitStateChanged` announces — and the trader
          // was shown "confirmed manually" for an order nobody touched by hand,
          // immediately followed by "fully matched" for the same order.
          //
          // Everything else still runs either way: the payer's hryvnia is in
          // the jar whoever recorded it, so the baseline still advances and the
          // Mini App is still told. Only the duplicate row goes.
          if (settledHere) {
            outcome.historyOrderEvents.push({
              orderId: order.orderId,
              amount: order.amount,
              status: OrderStatus.EXECUTED,
              executionReason: OrderExecutionReason.FULL_MATCH
            })
          } else {
            this.logger.log(
              `Order ${order.orderId} (${order.orderStringId}) was already settled by another ` +
                `path — most likely its own order.paid webhook — so this match adds no history entry.`
            )
          }

          this.logger.log(
            `✅ Order ${order.orderId} (${order.orderStringId}) matched and executed via Cumulative Delta.`
          )
        }

        // Identical to baselineBalance + totalDelta, but stated as the invariant
        // it is: the baseline can never exceed the money actually present.
        outcome.baselineBalance = currentBalance
        await this.terminalStateCache.updateBaseline(terminalId, outcome.baselineBalance, {
          deferEvent: true
        })
        this.logger.log(
          `Updated baseline for terminal ${terminalId} to ${outcome.baselineBalance}.`
        )

        await this.alertsService.resolvePendingAlertsForJar(terminalId)

        await this.terminalBalanceOrchestratorService.broadcastBalanceUpdate(
          terminalId,
          traderId,
          cardId,
          terminalName,
          sendId,
          currentBalance
        )
        break

      case MatchResultStatus.UNRECOGNIZED:
        // The trader paying in the last stretch themselves is not an unknown
        // deposit, even though no order accounts for it — it is the action
        // TERMINAL_FULL_WARNING just asked them to take. Checked before the
        // alert, because raising one here is precisely the bug: a second alert
        // for answering the first, with the jar full and nothing left to do.
        if (
          isGoalClosingTopUp(
            { goal, balance: currentBalance, unmatched: matchResult.amount },
            this.minOrderKopecks()
          )
        ) {
          await this.settleGoalReached(terminalId, currentBalance, matchResult.amount, outcome)
          break
        }

        if (matchResult.amount > 0) {
          const { alert, isNew } = await this.alertsService.createAlert(
            traderId,
            terminalId,
            AlertType.UNRECOGNIZED_DEPOSIT,
            matchResult.amount,
            { amount: matchResult.amount, totalDelta }
          )

          if (isNew) {
            // Only on the first sighting. The delta stays unmatched until the
            // trader resolves it, and every poll re-reaches this branch — logging
            // here unconditionally repeated the same line every few seconds for
            // as long as the deposit sat there.
            //
            // The sentence is for operators reading logs; the trader gets the
            // same facts as metadata and renders them in their own language.
            this.logger.warn(
              `[Terminal ${terminalId}] Unmatched deposit of ${matchResult.amount} kopecks. ` +
                `No combination of pending orders equals the total delta of ${totalDelta} kopecks.`
            )

            outcome.historyAlerts.push({
              type: alert.type as string as TerminalHistoryAlertType,
              details: { amount: matchResult.amount, ...(alert.metadata || {}) }
            })
          }
        }
        break

      // Braced so the declarations below are scoped to this case rather than
      // leaking into the whole switch.
      case MatchResultStatus.AMBIGUOUS: {
        // combinationsCount previously existed only inside the rendered
        // sentence, so the client's ALERTS.AMBIGUOUS_DESC interpolated a blank.
        const { newAlert: alert, isNew } = await this.alertsService.updateAmbiguousAlert(
          traderId,
          terminalId,
          totalDelta,
          { amount: totalDelta, combinationsCount: matchResult.combinationsCount }
        )

        if (isNew) {
          // First sighting only — see the UNRECOGNIZED branch above.
          this.logger.warn(
            `[Terminal ${terminalId}] Ambiguous deposit of ${totalDelta} kopecks. ` +
              `Found ${matchResult.combinationsCount} possible combinations. Leaving for manual resolution.`
          )

          outcome.historyAlerts.push({
            type: alert.type as string as TerminalHistoryAlertType,
            details: {
              amount: totalDelta,
              combinationsCount: matchResult.combinationsCount,
              ...(alert.metadata || {})
            }
          })
        }

        break
      }
    }

    // Announced once for the whole match rather than per branch: both the fuzzy
    // and the perfect path populate historyOrderEvents, and an empty list means
    // nothing settled, so there is nothing to tell anyone about.
    //
    // This is the only signal in the system for "fiat has demonstrably arrived
    // on this terminal" — OrderDbService.emitStateChanged stays silent for
    // scraper-driven executions. The Mini App's sales listen for it.
    if (outcome.historyOrderEvents.length > 0) {
      this.eventEmitter.emit(
        TERMINAL_ORDERS_EXECUTED,
        new TerminalOrdersExecutedEvent(
          terminalId,
          traderId,
          cardId,
          outcome.historyOrderEvents.map((event) => ({
            orderId: event.orderId,
            amount: event.amount,
            status: event.status,
            executionReason: event.executionReason ?? OrderExecutionReason.FULL_MATCH
          })),
          currentBalance
        )
      )
    }

    return outcome
  }

  /**
   * Records an order that was credited here but refused upstream.
   *
   * Called after `markCompleted`, never instead of it, and it deliberately
   * changes nothing about the rest of the match. The payer's hryvnia is in the
   * jar either way, so the baseline still advances, the Mini App is still told
   * its money arrived, and the order still counts — the only thing missing is a
   * confirmation on Transacto, and that is what the alert is for.
   *
   * The alternative was letting the refusal throw, which is what it used to do:
   * `processDelta` aborted before any of that bookkeeping, and the scraper
   * simply rescheduled and hit the same wall seconds later, indefinitely.
   *
   * Never throws. A failure to *raise the alert* must not cost the settlement
   * that already happened.
   */
  private async handleUnconfirmed(
    traderId: number,
    terminalId: number,
    order: { orderId: number; orderStringId: string; amount: number },
    confirmation: { outcome: OrderExecutionOutcome; errorCode?: number },
    outcome: MatchingOutcome
  ): Promise<void> {
    if (confirmation.outcome !== OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED) return

    try {
      await this.trackedOrderDbService.markAwaitingUpstreamConfirmation(order.orderId)

      const metadata = {
        amount: order.amount,
        orderId: order.orderId,
        orderStringId: order.orderStringId,
        errorCode: confirmation.errorCode ?? 0
      }

      const { alert, isNew } = await this.alertsService.createOrderConfirmationAlert(
        traderId,
        terminalId,
        metadata
      )

      if (isNew) {
        this.logger.error(
          `[Terminal ${terminalId}] Order ${order.orderId} (${order.orderStringId}) was credited ` +
            `locally but Transacto refused to confirm it: insufficient trader limit. ` +
            `It must be confirmed in the cabinet.`
        )

        outcome.historyAlerts.push({
          type: alert.type as string as TerminalHistoryAlertType,
          details: { ...metadata, ...(alert.metadata || {}) }
        })
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to record the unconfirmed order ${order.orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * Books the trader's own top-up as money accounted for, and closes the jar's
   * outstanding questions.
   *
   * Everything an ordinary match does, minus executing an order — because there
   * is no order to execute. The baseline has to advance or the same deposit is
   * re-evaluated on every scrape and eventually files itself as unknown anyway;
   * and `TERMINAL_FULL_WARNING` has to go with the deposit alerts, since the
   * remainder it was asking for has just arrived.
   *
   * Completing the sale and standing the terminal down is deliberately
   * *not* done here. `broadcastBalanceUpdate` has already gone out with the new
   * balance, and `SaleProgressListener` decides funding on the same rule
   * this method is gated by — so the Mini App closes its own order and disables
   * its own terminal, exactly as it does when the last order matches.
   */
  private async settleGoalReached(
    terminalId: number,
    currentBalance: number,
    amount: number,
    outcome: MatchingOutcome
  ): Promise<void> {
    this.logger.log(
      `[Terminal ${terminalId}] Goal reached by a manual top-up of ${amount} kopecks. ` +
        `Accounting for it and clearing the jar's alerts.`
    )

    outcome.baselineBalance = currentBalance
    await this.terminalStateCache.updateBaseline(terminalId, outcome.baselineBalance, {
      deferEvent: true
    })

    await this.alertsService.resolvePendingAlertsForJar(terminalId, [
      AlertType.UNRECOGNIZED_DEPOSIT,
      AlertType.AMBIGUOUS_DEPOSIT,
      AlertType.TERMINAL_FULL_WARNING
    ])
  }

  /** The smallest order Transacto will route, and so the width of the tail. */
  private minOrderKopecks(): number {
    return parseMinOrderKopecks(environments.TRANSACTO_MIN_ORDER_KOPECKS)
  }
}
