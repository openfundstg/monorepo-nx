import { ERROR, TerminalSource } from '@transacto/contracts'
import { Injectable, BadRequestException } from '@nestjs/common'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { AlertDocument } from 'src/modules/repositories/alerts-db/schemas'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { extractTargetId, extractSendId } from 'src/shared/utils'
import { TerminalStateCacheService } from 'src/modules/bank-scraper'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import { getBankProvider } from 'src/shared/utils'
import { BankProvider } from 'src/shared/constants/bank.constants'
import { TerminalUrlResolverService } from 'src/modules/terminal'

import { SafeBoxDbService } from 'src/modules/repositories/safe-box-db/services'
import { SafeBoxListQueryDto } from 'src/modules/extension/dto/safe-box-list.dto'

/**
 * One alert, in the shape the extension already expects from the socket.
 *
 * `metadata` stays **nested**. Both of these mappers used to spread it onto the
 * root and `delete` it — a leftover from when the template interpolated the
 * alert itself (`| translate: alert`). It now passes `alert.metadata`, so
 * flattening left that undefined and every REST-loaded alert rendered its
 * translation with the placeholders intact: "Mismatch of {{amount}} UAH".
 *
 * Only the REST path did it, which is why it looked intermittent — an alert
 * arriving live over `TERMINAL_ALERT_TRIGGERED` was fine, and the same alert
 * after a reload was not.
 *
 * `id` and `alertId` are added for the same reason the socket payload carries
 * them: the client reads `alert.id || alert._id`, and matching the socket shape
 * exactly is what keeps `TerminalAlertDto` honest for both routes.
 */
const toAlertDto = (alert: AlertDocument) => ({
  ...alert,
  id: alert._id.toString(),
  alertId: alert._id.toString()
})

@Injectable()
export class ExtensionDashboardService {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly terminalDbService: TerminalDbService,
    private readonly terminalStateCacheService: TerminalStateCacheService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly terminalHistoryDbService: TerminalHistoryDbService,
    private readonly safeBoxDbService: SafeBoxDbService,
    private readonly terminalUrlResolverService: TerminalUrlResolverService,
    private readonly saleDbService: TmaSaleDbService
  ) {}

  async getDashboard(traderId: number) {
    const rawAlerts = await this.alertsService.getUnreadAlerts(traderId)
    const alertTerminalIds = new Set(rawAlerts.map((a) => a.terminalId))

    const credentials = await this.terminalDbService.find({ traderId })

    // One query for the page rather than one per row. Only Mini App terminals
    // have an order behind them, so most cards get nothing back — which is
    // itself the answer for a terminal the trader made themselves.
    const remainderPolicies = await this.saleDbService.findRemainderPoliciesByCardIds(
      credentials.map((terminal) => terminal.cardId)
    )

    const terminals: any[] = []

    for (const terminal of credentials) {
      if (terminal && terminal.cred3) {
        const targetId = extractTargetId(terminal.cred3)
        if (targetId && (terminal.enabled || alertTerminalIds.has(terminal.terminalId))) {
          const currentState = await this.terminalStateCacheService.getCurrentState(
            terminal.terminalId
          )
          const baseline = await this.terminalStateCacheService.getBaseline(terminal.terminalId)
          const sendId = extractSendId(terminal.cred3)
          const pendingOrders = await this.trackedOrderDbService.getPendingOrdersForCard(
            terminal.cardId
          )

          const hasPendingOrders = pendingOrders.length > 0
          const pendingOrdersSum = pendingOrders.reduce((sum, order) => sum + order.amount, 0)

          // Three sources, most trustworthy first, and the order is load-bearing.
          //
          // `current` is the live scrape. It used to come *second*, so the
          // baseline overwrote it unconditionally — and the baseline is a
          // different number entirely: it is the fraud detector's reference
          // point, the money already accounted for by matched orders, and it
          // moves only when orders match. A manual sync therefore looked like it
          // worked, because the fresh figure went out over
          // TERMINAL_BALANCE_UPDATED and the UI took it, then reverted the
          // moment the extension was reopened and read this endpoint again.
          //
          // `lastBalance` is the same scraped figure, persisted to Mongo when it
          // last moved. It is here because `current` carries a one-hour TTL: a
          // jar nobody has polled for a while used to have only the baseline
          // left to report, and now reports what it actually holds.
          //
          // The baseline stays as the last resort, for terminals scraped before
          // `lastBalance` existed.
          const balance = currentState?.current ?? terminal.lastBalance ?? baseline ?? 0
          const goal = currentState?.goal || terminal.lastGoal || 0

          const bankProvider = getBankProvider(terminal.cred3) || BankProvider.MONO
          const url = this.terminalUrlResolverService.resolve(bankProvider, terminal.cred3)

          terminals.push({
            terminalId: terminal.terminalId,
            targetId,
            cardId: terminal.cardId,
            sendId,
            terminalName: terminal.terminalName || 'Unknown',
            // Terminals stored before this field existed carry none until the
            // next sync classifies them.
            source: terminal.source ?? TerminalSource.TRANSACTO,
            bankProvider,
            url,
            balance,
            goal,
            hasPendingOrders,
            pendingOrdersSum,
            enabled: terminal.enabled,
            // `?? true` because these are `.lean()` reads, which do not apply the
            // schema default — a terminal stored before the field existed was
            // routing normally.
            acceptingOrders: terminal.acceptingOrders ?? true,
            // Whether this jar will ever ask the trader for anything: one that
            // waits for the full amount raises "almost full" near its goal and
            // needs the last stretch paid in by hand; one that refunds its
            // remainder closes itself and never does.
            remainderPolicy: remainderPolicies.get(terminal.cardId),
            // When the figures were actually observed, as against `updatedAt`
            // below, which is when this response was built. They are the same
            // thing on a live terminal and very much not on a disabled one —
            // and a disabled terminal reaches this list whenever it still has an
            // unread alert.
            balanceAt: currentState ? new Date().toISOString() : terminal.lastBalanceAt?.toISOString(),
            updatedAt: new Date().toISOString()
          })
        }
      }
    }

    const alerts = rawAlerts.map(toAlertDto)

    const finalJars = terminals.filter((terminal) => {
      if (terminal.enabled) return true
      return alerts.some((a) => a.terminalId === terminal.terminalId)
    })

    return { terminals: finalJars, alerts }
  }

  async getTerminalHistory(traderId: number, cardIdStr: string) {
    const cardId = parseInt(cardIdStr, 10)
    if (isNaN(cardId)) {
      throw new BadRequestException(ERROR.TERMINAL.INVALID_CARD_ID)
    }

    const history = await this.terminalHistoryDbService.getHistoryForCard(traderId, cardId, 50)
    return { success: true, history }
  }

  async getAlerts(traderId: number) {
    const rawAlerts = await this.alertsService.getUnreadAlerts(traderId)
    const alerts = rawAlerts.map(toAlertDto)
    return { success: true, alerts }
  }

  async getSafeBoxList(traderId: number, query: SafeBoxListQueryDto) {
    const result = await this.safeBoxDbService.findAll(traderId, query)

    if (result.data.length === 0) return result

    const terminalIds = Array.from(new Set(result.data.map((item) => item.terminalId)))
    const terminals = await this.terminalDbService.find({
      traderId,
      terminalId: { $in: terminalIds }
    })

    const terminalMap = new Map(terminals.map((t) => [t.terminalId, t]))

    const enrichedData = result.data.map((item) => {
      const t = terminalMap.get(item.terminalId)
      const cred3 = t?.cred3 || null
      const bankProvider = getBankProvider(cred3) || BankProvider.MONO
      const url = this.terminalUrlResolverService.resolve(bankProvider, cred3)

      return {
        ...item,
        terminalName: t?.terminalName || 'Unknown',
        bankProvider,
        url
      }
    })

    return { ...result, data: enrichedData }
  }
}
