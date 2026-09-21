import {
  AdminDepositKind,
  AdminWsEventNames,
  AlertStatus,
  WsEventNames
} from '@transacto/contracts'
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type {
  TmaBalanceChangedEvent,
  TmaDepositChangedEvent,
  TmaFiatDepositChangedEvent,
  TmaSaleChangedEvent,
  TraderWsEvent
} from 'src/shared/interfaces'
import { describeError } from 'src/shared/utils'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminDepositsService } from 'src/modules/admin/services/admin-deposits.service'
import {
  displayName,
  toAdminAlert,
  toAdminSale,
  toAdminTerminal,
  toAdminUser
} from 'src/modules/admin/utils'

/** The payload every terminal balance event carries, as far as this listener cares. */
interface TerminalBalancePayload {
  readonly cardId?: number
  readonly terminalId?: number
}

/** The payload the alert events carry — the whole document plus its stringified id. */
interface AlertPayload {
  readonly _id?: unknown
  readonly id?: string
  readonly traderId: number
  readonly terminalId: number
  readonly type: Parameters<typeof toAdminAlert>[0]['type']
  readonly status: AlertStatus
  readonly amount: number
  readonly isRead: boolean
  readonly metadata?: Parameters<typeof toAdminAlert>[0]['metadata']
  readonly createdAt: Date
}

/**
 * Turns everything the system was already announcing into pushes for the admin
 * room.
 *
 * **This service is the entire reason the panel is live, and it originates
 * nothing.** Every handler here is a subscriber to an event the product already
 * emitted for its own reasons — a Mini App balance push, a trader's terminal
 * update, an alert being raised. Nothing was added to a write path to feed the
 * panel, so a screen nobody has open costs one no-op emit.
 *
 * Two consequences worth stating:
 *
 * - **Handlers re-read what they announce.** The events carry ids, not rows, so
 *   a handler fetches the current document and maps it. That costs an indexed
 *   lookup per event and buys a guarantee the panel cannot drift: the row
 *   pushed is the row stored, not the row the emitter happened to hold.
 * - **Nothing here may throw.** Every emitter is on a hot path — a scrape, a
 *   settlement, a webhook — and EventEmitter2 is synchronous, so an exception
 *   raised in a listener surfaces inside the thing that emitted it. A failure
 *   to update a dashboard must never fail a payment.
 */
@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name)

  constructor(
    private readonly gateway: AdminGateway,
    private readonly userDbService: TmaUserDbService,
    private readonly saleDbService: TmaSaleDbService,
    // Both rails' rows come from the one service the list reads through, so a
    // pushed deposit and a fetched one are the same object built the same way.
    private readonly depositsService: AdminDepositsService,
    private readonly terminalDbService: TerminalDbService
  ) {}

  // --- Mini App -------------------------------------------------------------

  @OnEvent(TMA_DOMAIN_EVENT.BALANCE_UPDATED)
  @OnEvent(TMA_DOMAIN_EVENT.REFERRAL_BALANCE_UPDATED)
  async handleBalanceChanged(event: TmaBalanceChangedEvent): Promise<void> {
    await this.guard('tma balance', async () => {
      const [user, openOrders] = await Promise.all([
        this.userDbService.findByTelegramId(event.telegramId),
        this.saleDbService.countOpenByTelegramIds([event.telegramId])
      ])
      if (!user) return

      this.gateway.emit(AdminWsEventNames.USER_UPDATED, {
        user: toAdminUser(user, openOrders[event.telegramId] ?? 0)
      })
    })
  }

  @OnEvent(TMA_DOMAIN_EVENT.DEPOSIT_STATUS_CHANGED)
  async handleDepositChanged(event: TmaDepositChangedEvent): Promise<void> {
    await this.guard('tma deposit', async () => {
      const deposit = await this.depositsService.row(
        AdminDepositKind.CRYPTO,
        event.depositId
      )
      if (deposit === null) return

      this.gateway.emit(AdminWsEventNames.DEPOSIT_UPDATED, { deposit })
    })
  }

  /**
   * A fiat top-up moved — reserved, covered a little further, completed, or
   * stopped for an operator.
   *
   * **The row is re-read through the service the list reads through**, not
   * assembled here. The event carries a status and a coverage figure; the
   * panel's row carries a dozen fields around them, the units are fixed in the
   * feed's own pipeline, and a second assembly of the same deposit is how a
   * live list and the same list after a refresh come to disagree.
   */
  @OnEvent(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STATUS_CHANGED)
  async handleFiatDepositChanged(event: TmaFiatDepositChangedEvent): Promise<void> {
    await this.guard('tma fiat deposit', async () => {
      const deposit = await this.depositsService.row(AdminDepositKind.FIAT, event.depositId)
      if (deposit === null) return

      this.gateway.emit(AdminWsEventNames.FIAT_DEPOSIT_UPDATED, { deposit })
    })
  }

  /**
   * Both the status change and the progress snapshot land here.
   *
   * One handler because the panel's row is the same either way — a progress
   * push moves `receivedAmount` and `jarBalance`, a status push moves `status`,
   * and the list shows all three in the same row.
   */
  @OnEvent(TMA_DOMAIN_EVENT.SALE_STATUS_CHANGED)
  @OnEvent(TMA_DOMAIN_EVENT.SALE_PROGRESS)
  async handleSaleChanged(event: TmaSaleChangedEvent): Promise<void> {
    await this.guard('tma sale', async () => {
      const [order, user] = await Promise.all([
        this.saleDbService.findById(event.saleId),
        this.userDbService.findByTelegramId(event.telegramId)
      ])
      if (!order) return

      this.gateway.emit(AdminWsEventNames.SALE_UPDATED, {
        order: toAdminSale(order, displayName(user ?? undefined, event.telegramId))
      })
    })
  }

  // --- Trader side ----------------------------------------------------------

  /**
   * The trader bus, reused wholesale.
   *
   * `ws.emit` already carries every terminal and alert movement to the
   * extension, so subscribing to it makes the panel live for the trader half of
   * the system without a single new emission anywhere. The `switch` ignores
   * what the panel has no row for rather than pushing it as an untyped blob.
   */
  @OnEvent('ws.emit')
  async handleTraderEvent(event: TraderWsEvent<unknown>): Promise<void> {
    await this.guard(`trader event ${event.event}`, async () => {
      switch (event.event) {
        case WsEventNames.TERMINAL_BALANCE_UPDATED:
        case WsEventNames.TERMINAL_ENABLED:
        case WsEventNames.TERMINAL_DISABLED:
          return this.pushTerminal(event.data as TerminalBalancePayload)

        case WsEventNames.TERMINAL_ALERT_TRIGGERED:
        case WsEventNames.TERMINAL_ALERT_RESOLVED:
          return this.pushAlert(event.data as AlertPayload)

        case WsEventNames.TERMINAL_HISTORY_UPDATED:
          // Forwarded verbatim. The panel's history screen renders the very
          // same table the extension does, from the same shared component, so
          // it needs the same payload — mapping it into an admin shape here
          // would mean the two screens showed different rows for one scrape.
          return this.pushHistory(event.data)

        // TRADER_DEACTIVATED has no live row in the panel: it is already
        // covered by the audit push that caused it.
        default:
          return
      }
    })
  }

  private async pushTerminal(payload: TerminalBalancePayload): Promise<void> {
    // Keyed by cardId where it is present: it is the only identifier every one
    // of these payloads carries, and terminalId is null on a terminal that
    // never reached Transacto.
    const filter =
      payload.cardId !== undefined
        ? { cardId: payload.cardId }
        : payload.terminalId !== undefined
          ? { terminalId: payload.terminalId }
          : null
    if (!filter) return

    const terminal = await this.terminalDbService.findOne(filter)
    if (!terminal) return

    this.gateway.emit(AdminWsEventNames.TERMINAL_UPDATED, {
      terminal: toAdminTerminal(terminal as Parameters<typeof toAdminTerminal>[0])
    })
  }

  /**
   * One history row, exactly as the trader's extension receives it.
   *
   * No re-read and no mapping: the payload is already the whole record, the
   * shared table takes it as-is, and a lookup here would only add a way for the
   * two views of one scrape to disagree.
   */
  private async pushHistory(payload: unknown): Promise<void> {
    this.gateway.emit(AdminWsEventNames.TERMINAL_HISTORY_APPENDED, payload)
  }

  private async pushAlert(payload: AlertPayload): Promise<void> {
    // Mapped straight off the payload rather than re-read: the alert events
    // already carry the whole document, so a lookup would buy nothing and the
    // resolved-alert push would race the write that resolved it.
    this.gateway.emit(AdminWsEventNames.ALERT_UPDATED, {
      alert: toAdminAlert({
        _id: { toString: () => payload.id ?? String(payload._id) },
        traderId: payload.traderId,
        terminalId: payload.terminalId,
        type: payload.type,
        status: payload.status,
        amount: payload.amount,
        isRead: payload.isRead,
        metadata: payload.metadata,
        createdAt: payload.createdAt
      })
    })
  }

  /**
   * Runs a handler and swallows whatever it throws.
   *
   * The one thing every handler here shares, and the reason it is a helper
   * rather than a `try` in each: a listener that forgets it becomes a way for
   * the dashboard to break a payment.
   */
  private async guard(context: string, work: () => Promise<void>): Promise<void> {
    // Nobody is watching, so there is nothing to compute. This is the first
    // line of every handler for a reason: they re-read the row they announce,
    // and these events fire on the scraper's and the settlement's hot paths.
    // A panel nobody has open must cost one boolean, not a query per scrape.
    if (!this.gateway.hasListeners()) return

    try {
      await work()
    } catch (error: unknown) {
      this.logger.error(`Admin broadcast failed for ${context}: ${describeError(error)}`)
    }
  }
}
