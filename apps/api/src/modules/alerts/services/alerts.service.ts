import { Injectable } from '@nestjs/common'
import type { AlertMetadataMap } from '@transacto/contracts'
import { AlertDocument, AlertStatus, AlertType } from 'src/modules/repositories/alerts-db/schemas'
import { AlertDbService } from 'src/modules/repositories/alerts-db/services'

@Injectable()
export class AlertsService {
  constructor(private readonly alertDbService: AlertDbService) {}

  /**
   * @param metadata Interpolation parameters the client needs to render this
   *   alert in its own language. No rendered sentence is stored — see the
   *   `metadata` note on the Alert schema.
   */
  async createAlert<T extends AlertType>(
    traderId: number,
    terminalId: number,
    type: T,
    amount: number,
    metadata?: AlertMetadataMap[T]
  ): Promise<{ alert: AlertDocument; isNew: boolean }> {
    const existing = await this.alertDbService.findOne({
      terminalId,
      type,
      amount,
      status: AlertStatus.PENDING
    })

    if (existing) {
      return { alert: existing, isNew: false }
    }
    const alert = await this.alertDbService.create({
      traderId,
      terminalId,
      type,
      amount,
      metadata
    })
    return { alert, isNew: true }
  }

  async getUnreadAlerts(traderId: number): Promise<AlertDocument[]> {
    return this.alertDbService.find({ traderId, status: AlertStatus.PENDING }, undefined, {
      sort: { createdAt: -1 }
    })
  }

  async getUnresolvedDepositSum(terminalId: number): Promise<number> {
    const alerts = await this.alertDbService.find({
      terminalId,
      status: AlertStatus.PENDING,
      type: { $in: [AlertType.UNRECOGNIZED_DEPOSIT, AlertType.AMBIGUOUS_DEPOSIT] }
    })

    let sum = 0
    for (const alert of alerts) {
      sum += alert.amount
    }
    return sum
  }

  /**
   * Clears the jar's outstanding deposit questions once money is accounted for.
   *
   * `types` is a parameter because the goal-closing top-up has to clear one
   * more than an ordinary match does: an order matching says nothing about
   * whether the jar is still short of its target, but a top-up that reaches the
   * target makes `TERMINAL_FULL_WARNING` obsolete — there is no remainder left
   * to ask the trader for.
   */
  async resolvePendingAlertsForJar(
    terminalId: number,
    types: readonly AlertType[] = [AlertType.UNRECOGNIZED_DEPOSIT, AlertType.AMBIGUOUS_DEPOSIT]
  ): Promise<AlertDocument[]> {
    const alertsToResolve = await this.alertDbService.find({
      terminalId,
      status: AlertStatus.PENDING,
      type: { $in: types }
    })

    for (const alert of alertsToResolve) {
      await this.resolveAlert(alert._id.toString())
    }
    return alertsToResolve
  }

  async updateAmbiguousAlert(
    traderId: number,
    terminalId: number,
    amount: number,
    metadata: AlertMetadataMap[AlertType.AMBIGUOUS_DEPOSIT]
  ): Promise<{ newAlert: AlertDocument; resolvedAlerts: AlertDocument[]; isNew: boolean }> {
    const existingSame = await this.alertDbService.findOne({
      terminalId,
      status: AlertStatus.PENDING,
      type: AlertType.AMBIGUOUS_DEPOSIT,
      amount
    })

    if (existingSame) {
      return { newAlert: existingSame, resolvedAlerts: [], isNew: false }
    }

    const resolvedAlerts = await this.alertDbService.find({
      terminalId,
      status: AlertStatus.PENDING,
      type: AlertType.AMBIGUOUS_DEPOSIT
    })
    for (const alert of resolvedAlerts) {
      await this.resolveAlert(alert._id.toString())
    }

    const { alert: newAlert } = await this.createAlert(
      traderId,
      terminalId,
      AlertType.AMBIGUOUS_DEPOSIT,
      amount,
      metadata
    )
    return { newAlert, resolvedAlerts, isNew: true }
  }

  /**
   * Raises — or re-uses — the alert for one order Transacto refused to confirm.
   *
   * Its own method rather than `createAlert`, for the same reason
   * {@link updateAmbiguousAlert} has one: the shared deduplication key is
   * `(terminalId, type, amount)`, and two different orders for the same amount
   * on the same jar are two separate pieces of work. Keying on the order id
   * instead means each one gets its own standing reminder, carrying its own
   * `orderStringId` for the trader to search the cabinet with.
   */
  async createOrderConfirmationAlert(
    traderId: number,
    terminalId: number,
    metadata: AlertMetadataMap[AlertType.ORDER_CONFIRMATION_FAILED]
  ): Promise<{ alert: AlertDocument; isNew: boolean }> {
    const existing = await this.alertDbService.findOne({
      terminalId,
      type: AlertType.ORDER_CONFIRMATION_FAILED,
      status: AlertStatus.PENDING,
      'metadata.orderId': metadata.orderId
    })

    if (existing) return { alert: existing, isNew: false }

    const alert = await this.alertDbService.create({
      traderId,
      terminalId,
      type: AlertType.ORDER_CONFIRMATION_FAILED,
      amount: metadata.amount,
      metadata
    })

    return { alert, isNew: true }
  }

  /**
   * Clears that reminder once the order really is confirmed upstream.
   *
   * Matched on the order id rather than the terminal, so a retry that succeeds
   * cannot resolve a sibling order's alert that is still outstanding.
   */
  async resolveOrderConfirmationAlert(orderId: number): Promise<void> {
    const alerts = await this.alertDbService.find({
      type: AlertType.ORDER_CONFIRMATION_FAILED,
      status: AlertStatus.PENDING,
      'metadata.orderId': orderId
    })

    for (const alert of alerts) await this.resolveAlert(alert._id.toString())
  }

  async acknowledgeAlert(alertId: string, traderId: number): Promise<AlertDocument | null> {
    const existing = await this.alertDbService.findOne({
      _id: alertId,
      traderId,
      status: AlertStatus.PENDING
    })
    if (!existing) return null

    return this.alertDbService.findByIdAndUpdate(alertId, {
      $set: { status: AlertStatus.RESOLVED }
    })
  }

  async hasPendingAlertOfType(terminalId: number, type: AlertType): Promise<boolean> {
    const count = await this.alertDbService.countDocuments({
      terminalId,
      status: AlertStatus.PENDING,
      type
    })
    return count > 0
  }

  /**
   * The query filters on `type`, so every row is known to carry that type's
   * metadata — the return type says so and callers can read its fields without
   * narrowing the union by hand.
   */
  async getPendingAlertsOfType<T extends AlertType>(
    terminalId: number,
    type: T
  ): Promise<(AlertDocument & { metadata?: AlertMetadataMap[T] })[]> {
    return this.alertDbService.find({
      terminalId,
      status: AlertStatus.PENDING,
      type
    }) as Promise<(AlertDocument & { metadata?: AlertMetadataMap[T] })[]>
  }

  async resolveAlert(alertId: string): Promise<void> {
    await this.alertDbService.findByIdAndUpdate(alertId, {
      $set: { status: AlertStatus.RESOLVED }
    })
  }

  async readAlert(alertId: string, traderId: number): Promise<AlertDocument | null> {
    const existing = await this.alertDbService.findOne({ _id: alertId, traderId })
    if (!existing) return null

    const updates: any = { isRead: true }
    if ([AlertType.FRAUD, AlertType.TERMINAL_FULL_WARNING].includes(existing.type)) {
      updates.status = AlertStatus.RESOLVED
    }

    return this.alertDbService.findByIdAndUpdate(alertId, { $set: updates })
  }
}
