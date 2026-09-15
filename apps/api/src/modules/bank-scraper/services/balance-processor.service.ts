import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TerminalStateCacheService } from './terminal-state-cache.service'
import { TerminalErrorHandlerService } from './terminal-error-handler.service'
import { OrderMatcherService, MatchingOutcome } from './order-matcher.service'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { AlertType, AlertDocument } from 'src/modules/repositories/alerts-db/schemas'
import type { ScraperJobData } from 'src/shared/constants'
import { parseMinOrderKopecks } from 'src/shared/utils'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleRemainderPolicy } from '@transacto/contracts'
import environments from 'src/environments'
import {
  TerminalHistoryOrderEvent,
  TerminalHistoryAlert,
  TerminalHistoryAlertType
} from 'src/modules/repositories/terminal-history-db/schemas'

@Injectable()
export class BalanceProcessorService {
  private readonly logger = new Logger(BalanceProcessorService.name)

  constructor(
    private readonly terminalHistoryDbService: TerminalHistoryDbService,
    private readonly alertsService: AlertsService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly terminalStateCache: TerminalStateCacheService,
    private readonly errorHandler: TerminalErrorHandlerService,
    private readonly orderMatcher: OrderMatcherService,
    private readonly eventEmitter: EventEmitter2,
    private readonly saleDbService: TmaSaleDbService
  ) {}

  async processBalance(
    data: ScraperJobData,
    terminalName: string,
    sendId: string,
    currentBalance: number,
    goal: number | null | undefined,
    incrementalDelta: number,
    cachedBalance: number
  ): Promise<{ shouldRequeue: boolean; customDelay?: number }> {
    const { terminalId, traderId, cardId, apiToken } = data

    const baselineStr = await this.terminalStateCache.getBaseline(terminalId)
    if (baselineStr === null) {
      await this.terminalStateCache.updateBaseline(terminalId, currentBalance, { deferEvent: true })
      this.logger.log(
        `Initialized baseline for terminal ${terminalId} at ${currentBalance} kopecks.`
      )
      await this.terminalStateCache.updateCurrentState(
        terminalId,
        currentBalance,
        goal ?? undefined
      )
      return { shouldRequeue: true }
    }

    let baselineBalance = baselineStr
    const historyAlerts: TerminalHistoryAlert[] = []
    const historyOrderEvents: TerminalHistoryOrderEvent[] = []

    if (currentBalance < baselineBalance) {
      // Money leaving a jar whose sale is already over is its owner taking
      // their own hryvnia out, and there is nothing to alert anybody about.
      //
      // The reading is identical to the one that means fraud; what differs is
      // that routing was switched off when the order ended, so no Transacto
      // order can ever be sent here again and no payer can be left short. The
      // jar is watched from here on for exactly one thing — the closure that
      // gives the user their sale slot back — and the old behaviour
      // took even that away: the FRAUD verdict disables the terminal, the
      // scrape loop stops, and the closure is then never noticed at all. A user
      // who withdrew their own money was left alarming an operator *and* stuck
      // at 1/1 until somebody released the jar by hand.
      if (await this.isOwnWithdrawal(cardId)) {
        // Rebased, not ignored. Leaving the old figure standing would re-read
        // the same withdrawal on every scrape, and would measure the next
        // deposit — a late payer's, say — against a jar balance that no longer
        // exists.
        await this.terminalStateCache.updateBaseline(terminalId, currentBalance, {
          deferEvent: true
        })
        await this.terminalStateCache.updateCurrentState(
          terminalId,
          currentBalance,
          goal ?? undefined
        )

        this.logger.log(
          `[Terminal ${terminalId}] Jar balance fell from ${baselineBalance} to ` +
            `${currentBalance} kopecks after its sale had already ended. That is the owner ` +
            `withdrawing their own money, so no alert is raised and the terminal keeps being ` +
            `watched until the jar is closed.`
        )

        return { shouldRequeue: true }
      }

      const fraudAlert = await this.errorHandler.handleFraudOrWithdrawal(
        terminalId,
        traderId,
        cardId,
        baselineBalance,
        currentBalance,
        apiToken
      )
      if (fraudAlert)
        historyAlerts.push({
          type: fraudAlert.type as string as TerminalHistoryAlertType,
          details: { ...(fraudAlert.metadata || {}) }
        })

      await this.terminalStateCache.updateCurrentState(
        terminalId,
        currentBalance,
        goal ?? undefined,
        {
          orderEvents: historyOrderEvents,
          alerts: historyAlerts
        }
      )

      return { shouldRequeue: false } // Do NOT requeue terminal
    }

    const fullAlert = await this.checkJarFullWarning(
      terminalId,
      traderId,
      cardId,
      currentBalance,
      goal ?? undefined
    )
    if (fullAlert) {
      historyAlerts.push({
        type: fullAlert.type as string as TerminalHistoryAlertType,
        details: { ...(fullAlert.metadata || {}) }
      })
    }

    const totalDelta = currentBalance - baselineBalance

    if (totalDelta === 0) {
      const pendingOrders = await this.trackedOrderDbService.getPendingOrdersForCard(cardId)
      await this.terminalStateCache.updateCurrentState(
        terminalId,
        currentBalance,
        goal ?? undefined,
        {
          orderEvents: historyOrderEvents,
          alerts: historyAlerts
        }
      )

      if (!pendingOrders.length) {
        this.logger.log(
          `Polling loop throttled to 10s for terminal ${terminalId} (0 pending orders).`
        )
        return { shouldRequeue: true, customDelay: 10000 }
      } else {
        return { shouldRequeue: true }
      }
    }

    const outcome = await this.orderMatcher.processDelta(
      terminalId,
      traderId,
      cardId,
      terminalName,
      sendId,
      currentBalance,
      baselineBalance,
      totalDelta,
      apiToken,
      // Needed to tell the trader's own top-up from a deposit nobody can
      // account for — the two are indistinguishable without the target.
      goal ?? undefined
    )

    baselineBalance = outcome.baselineBalance
    historyOrderEvents.push(...outcome.historyOrderEvents)
    historyAlerts.push(...outcome.historyAlerts)

    await this.terminalStateCache.updateCurrentState(
      terminalId,
      currentBalance,
      goal ?? undefined,
      {
        orderEvents: historyOrderEvents,
        alerts: historyAlerts
      }
    )
    return { shouldRequeue: true }
  }

  private async checkJarFullWarning(
    terminalId: number,
    traderId: number,
    cardId: number,
    currentBalance: number,
    goal: number | undefined
  ): Promise<AlertDocument | void> {
    const pendingAlerts = await this.alertsService.getPendingAlertsOfType(
      terminalId,
      AlertType.TERMINAL_FULL_WARNING
    )

    const remaining = goal !== undefined ? goal - currentBalance : null
    // The alert fires exactly where the pipeline runs out of room: below one
    // minimum order, nothing more can arrive on its own, so this is the trader's
    // cue to pay the rest in by hand. Read from the same place the funding rule
    // reads it, so the warning and the completion can never point at different
    // moments.
    const minOrder = parseMinOrderKopecks(environments.TRANSACTO_MIN_ORDER_KOPECKS)
    // Strictly above zero: the warning exists to name a remainder the trader
    // has to pay in, and once the goal is met there is none. Without the lower
    // bound the alert was recreated with `left: 0` — and, on a jar past its
    // goal, with a negative one, which rendered as "only -103 UAH left".
    const isCurrentlyFull = remaining !== null && remaining > 0 && remaining <= minOrder

    for (const alert of pendingAlerts) {
      const alertRemaining = alert.metadata?.left
      const alertGoal = alert.metadata?.goal

      if (alertGoal !== goal || alertRemaining !== remaining || !isCurrentlyFull) {
        await this.alertsService.resolveAlert(alert._id.toString())
      }
    }

    // Nobody has to pay this remainder in, so nobody should be asked to.
    //
    // The warning exists to tell a trader that the pipeline has run out of room
    // and the last stretch is theirs to cover by hand. A Mini App sale
    // set to refund its tail closes itself at exactly this moment instead — so
    // the alert fires on the same scrape that completes the order, and asks for
    // an action that is already unnecessary by the time it is read.
    //
    // Checked only once the alert would otherwise fire, which is rare, rather
    // than on every scrape.
    if (isCurrentlyFull && (await this.needsNoTopUp(cardId))) {
      // Not just "do not raise one" — clear any that is already standing.
      //
      // The resolve loop above only fires when the figures moved or the jar
      // stopped being full, and neither happens here: the jar sits at the same
      // balance with the same remainder. So a warning raised before the order's
      // policy was known would have stayed pending for good, and an unread
      // alert pins its terminal to the trader's active jars.
      for (const alert of pendingAlerts) await this.alertsService.resolveAlert(alert._id.toString())

      this.logger.debug(
        `[Terminal ${terminalId}] Jar is within one order of its goal, but its sale ` +
          `wants no top-up — either it refunds its remainder or its user has stopped it. ` +
          `No warning is raised.`
      )
      return
    }

    if (isCurrentlyFull && goal !== undefined) {
      const validExisting = pendingAlerts.find(
        (a) => a.metadata?.goal === goal && a.metadata?.left === remaining
      )

      if (!validExisting) {
        this.logger.warn(
          `[Terminal ${terminalId}] Terminal is almost full! ` +
            `Only ${remaining} kopecks left to reach the goal of ${goal} kopecks.`
        )

        const { alert } = await this.alertsService.createAlert(
          traderId,
          terminalId,
          AlertType.TERMINAL_FULL_WARNING,
          0,
          { goal, left: remaining }
        )

        return alert
      }
    }
  }

  /**
   * Whether a balance below the baseline is the jar owner's own withdrawal.
   *
   * Never throws, and **fails towards the alert**: a lookup that could not be
   * made must not be the reason a real emptying goes unreported. The mistake
   * that direction is a false alarm an operator dismisses; the other direction
   * is silence.
   */
  private async isOwnWithdrawal(cardId: number): Promise<boolean> {
    try {
      return await this.saleDbService.isAwaitingJarClosureByCardId(cardId)
    } catch (error: unknown) {
      this.logger.warn(
        `Could not read the sale for card ${cardId} while deciding whether a balance ` +
          `drop is a withdrawal: ${error instanceof Error ? error.message : String(error)}`
      )

      return false
    }
  }

  /**
   * Whether this terminal belongs to a sale that gives its tail back.
   *
   * Read through the repository rather than the Mini App's own services: the
   * Mini App depends on this module, so reaching the other way would close a
   * cycle. A `-db` service depends on nothing, which is what makes it safe.
   *
   * Never throws. A jar-full warning is worth raising even if this lookup
   * fails; suppressing one on an error would hide the very thing the alert is
   * for.
   */
  private async needsNoTopUp(cardId: number): Promise<boolean> {
    try {
      const order = await this.saleDbService.findOpenByCardId(cardId)
      // No open order, but a finished sale whose jar is still open: the target
      // was reached or the sale was called off, and the remainder the warning
      // would name is an artefact of its owner withdrawing from a jar that owes
      // nobody anything. Asking a trader to pay it in would be asking them to
      // refill somebody else's emptied jar.
      //
      // A card with no sale at all — a terminal the trader made
      // themselves — falls through to `false` as it always did, which is the
      // case the warning exists for.
      if (!order) return this.saleDbService.isAwaitingJarClosureByCardId(cardId)

      // Two different jars, one answer. A refunding order closes itself at
      // exactly this moment, so the last stretch is never anyone's to pay in.
      // A closing one was abandoned by its own user — asking a trader to top it
      // up would push it to completion against the wish that stopped it, and
      // spend their hryvnia doing so.
      return (
        order.remainderPolicy === SaleRemainderPolicy.REFUND_TO_BALANCE ||
        order.status === TmaSaleStatus.CLOSING
      )
    } catch (error: unknown) {
      this.logger.warn(
        `Could not read the sale for card ${cardId} while deciding on a jar-full ` +
          `warning: ${error instanceof Error ? error.message : String(error)}`
      )

      return false
    }
  }
}
