import { ERROR } from '@transacto/contracts'
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import { TerminalStateCacheService } from 'src/modules/bank-scraper'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { SafeBoxDbService } from 'src/modules/repositories/safe-box-db/services'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { OrderStatus, OrderExecutionReason } from 'src/modules/repositories/order-db/schemas'
import { MoveToBoxDto, ForceMatchDto } from 'src/modules/extension/dto/alert-actions.dto'
import {
  TerminalHistoryAlertType,
  TerminalHistoryOrderEvent,
  TerminalHistoryAlert
} from 'src/modules/repositories/terminal-history-db/schemas'
import { Alert } from 'src/modules/repositories/alerts-db/schemas'
import { ensure } from 'src/shared/utils'
export enum AlertResolutionAction {
  ACKNOWLEDGE = 'ACKNOWLEDGE',
  IGNORE = 'IGNORE'
}

interface AlertActionContext {
  orderEvents?: TerminalHistoryOrderEvent[]
  alerts?: TerminalHistoryAlert[]
}

@Injectable()
export class ExtensionAlertsActionService {
  private readonly logger = new Logger(ExtensionAlertsActionService.name)

  constructor(
    private readonly alertsService: AlertsService,
    private readonly terminalStateCacheService: TerminalStateCacheService,
    private readonly transactoApiService: TransactoApiService,
    private readonly safeBoxDbService: SafeBoxDbService,
    private readonly trackedOrderDbService: OrderDbService
  ) {}

  async readAlert(traderId: number, alertId: string) {
    const alert = ensure(
      await this.alertsService.readAlert(alertId, traderId),
      new NotFoundException(ERROR.ALERT.NOT_FOUND)
    )
    return { success: true, alert }
  }

  async acknowledgeAlert(traderId: number, apiToken: string, alertId: string) {
    const alert = await this.processAlertResolution(traderId, alertId, (resolvedAlert) => {
      return {
        amountDelta: resolvedAlert.amount,
        context: {
          alerts: [
            {
              type: TerminalHistoryAlertType.ALERT_RESOLVED,
              details: { amount: resolvedAlert.amount, action: AlertResolutionAction.ACKNOWLEDGE }
            }
          ]
        },
        logMessage: `acknowledged alert ${alertId}. Baseline for ${resolvedAlert.terminalId} increased by ${resolvedAlert.amount}.`
      }
    })

    return { success: true, alert }
  }

  async moveToBox(traderId: number, alertId: string, body: MoveToBoxDto) {
    await this.processAlertResolution(traderId, alertId, async (resolvedAlert) => {
      await this.safeBoxDbService.create({
        traderId,
        terminalId: resolvedAlert.terminalId,
        amount: body.amount,
        originalDelta: resolvedAlert.amount,
        comment: body.comment,
        alertCreatedAt: resolvedAlert.createdAt
      })

      return {
        amountDelta: body.amount,
        context: {
          alerts: [
            {
              type: TerminalHistoryAlertType.SAFE_TRANSFER,
              details: { amount: body.amount, comment: body.comment }
            }
          ]
        },
        logMessage: `moved alert ${alertId} to box. Baseline for ${resolvedAlert.terminalId} increased by ${body.amount}.`
      }
    })

    return { success: true }
  }

  async forceMatch(traderId: number, apiToken: string, alertId: string, body: ForceMatchDto) {
    await this.processAlertResolution(traderId, alertId, async (resolvedAlert) => {
      await this.trackedOrderDbService.markCompleted(
        body.orderId,
        OrderStatus.EXECUTED,
        OrderExecutionReason.EXTENSION,
        body.actualAmount
      )

      return {
        amountDelta: body.actualAmount,
        context: {
          orderEvents: [
            {
              orderId: body.orderId,
              amount: body.actualAmount,
              status: OrderStatus.EXECUTED,
              executionReason: OrderExecutionReason.EXTENSION
            }
          ]
        },
        logMessage: `force matched order ${body.orderId}. Baseline increased by ${body.actualAmount}.`
      }
    })

    try {
      // See `Order.executionStartedAt`: their `order.paid` echo must not be
      // mistaken for an operator's own confirmation.
      await this.trackedOrderDbService.markExecutionStarted(body.orderId)

      await this.transactoApiService.executeOrder(apiToken, body.orderId)
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      this.logger.warn(`Failed to execute order ${body.orderId} on Transacto: ${errorMessage}`)
    }

    return { success: true }
  }

  async ignoreAlert(traderId: number, alertId: string) {
    const alert = ensure(
      await this.alertsService.acknowledgeAlert(alertId, traderId),
      new BadRequestException(ERROR.ALERT.ALREADY_RESOLVED)
    )

    return { success: true }
  }

  /**
   * Helper to process common alert resolution tasks: acknowledge alert, execute handler, update baseline.
   */
  private async processAlertResolution(
    traderId: number,
    alertId: string,
    handler: (
      alert: Alert
    ) =>
      | Promise<{ amountDelta: number; context: AlertActionContext; logMessage: string }>
      | { amountDelta: number; context: AlertActionContext; logMessage: string }
  ): Promise<Alert> {
    const alert = ensure(
      await this.alertsService.acknowledgeAlert(alertId, traderId),
      new BadRequestException(ERROR.ALERT.NOT_RESOLVABLE)
    )

    const { amountDelta, context, logMessage } = await handler(alert)

    const baseline = await this.terminalStateCacheService.getBaseline(alert.terminalId)
    if (baseline !== null) {
      const newBaseline = baseline + amountDelta
      await this.terminalStateCacheService.updateBaseline(alert.terminalId, newBaseline, context)
      this.logger.log(`Trader ${traderId} ${logMessage}`)
    }

    return alert
  }
}
