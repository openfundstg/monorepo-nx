import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TerminalSource } from '@transacto/contracts'
import type { TerminalDisabledDto, TerminalEnabledDto } from '@transacto/contracts'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import type { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { BankProvider } from 'src/shared/constants/bank.constants'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { extractSendId, extractTargetId, getBankProvider } from 'src/shared/utils'
import { TerminalUrlResolverService } from './terminal-url-resolver.service'

/**
 * Tells a trader's extension that a terminal has appeared or gone.
 *
 * `terminal.enabled` and `terminal.disabled` were declared on both sides of the
 * socket and emitted by nobody. The events existed, the client listened for
 * them, and no line of backend code had ever sent one — so a terminal created
 * or switched off only reached the dashboard on a reload, or sideways through a
 * balance broadcast that happened to mention a card the client did not know.
 *
 * **The enabled payload is a whole card, and that is the point.** A terminal is
 * announced the instant it exists; the scraper's first pass is seconds to
 * minutes behind. Everything the card renders — the balance last seen, the
 * jar's target, the bank, the link, the pending total — is already stored, so
 * there is nothing to wait for. Sending two identifiers and letting the client
 * fill the rest in later is what produced an empty row that populated itself a
 * minute afterwards.
 *
 * Never throws. Both callers are in the middle of something that matters more
 * than a socket frame — creating a terminal, or taking one out of service — and
 * the client reconciles on its next load either way.
 */
@Injectable()
export class TerminalBroadcastService {
  private readonly logger = new Logger(TerminalBroadcastService.name)

  constructor(
    private readonly orderDbService: OrderDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly urlResolver: TerminalUrlResolverService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /** One terminal, as a card the extension can render without asking anything. */
  async announceEnabled(terminal: Terminal): Promise<void> {
    try {
      const [pendingOrders, remainderPolicies] = await Promise.all([
        this.orderDbService.getPendingOrdersForCard(terminal.cardId),
        this.saleDbService.findRemainderPoliciesByCardIds([terminal.cardId])
      ])

      const pendingOrdersSum = pendingOrders.reduce((sum, order) => sum + order.amount, 0)
      const bankProvider = getBankProvider(terminal.cred3) || BankProvider.MONO

      const dto: TerminalEnabledDto = {
        terminalId: terminal.terminalId,
        cardId: terminal.cardId,
        targetId: extractTargetId(terminal.cred3) ?? undefined,
        sendId: extractSendId(terminal.cred3) ?? undefined,
        terminalName: terminal.terminalName || 'Unknown',
        // Terminals stored before this field existed carry none until the next
        // sync classifies them.
        source: terminal.source ?? TerminalSource.TRANSACTO,
        bankProvider,
        url: this.urlResolver.resolve(bankProvider, terminal.cred3) ?? undefined,
        // The persisted figures, not a scrape. This is the whole reason the
        // card can be complete the moment it appears.
        balance: terminal.lastBalance ?? 0,
        goal: terminal.lastGoal ?? undefined,
        hasPendingOrders: pendingOrders.length > 0,
        pendingOrdersSum,
        // `?? true`: a `.lean()` read applies no schema default, so a terminal
        // stored before the field existed was routing normally.
        acceptingOrders: terminal.acceptingOrders ?? true,
        remainderPolicy: remainderPolicies.get(terminal.cardId),
        balanceAt: terminal.lastBalanceAt?.toISOString(),
        updatedAt: new Date().toISOString()
      }

      this.emit(terminal.traderId, WsEventNames.TERMINAL_ENABLED, dto)
    } catch (error: unknown) {
      this.logger.error(
        `Could not announce terminal ${terminal.terminalId} (card_id ${terminal.cardId}) to ` +
          `trader ${terminal.traderId}: ${this.describe(error)}`
      )
    }
  }

  /**
   * A terminal that is no longer in service.
   *
   * Two identifiers, deliberately: the client already holds the card and only
   * has to decide whether to drop it. It keeps one that still has unread
   * alerts, since dropping that would take the trader's only notice of what
   * went wrong.
   */
  announceDisabled(traderId: number, terminalId: number, cardId: number): void {
    const dto: TerminalDisabledDto = { terminalId, cardId }

    this.emit(traderId, WsEventNames.TERMINAL_DISABLED, dto)
  }

  private emit(traderId: number, event: WsEventNames, data: unknown): void {
    this.eventEmitter.emit('ws.emit', new TraderWsEvent(traderId, event, data))
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
