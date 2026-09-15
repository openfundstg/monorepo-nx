import type { OrderStatus, OrderExecutionReason } from '@transacto/contracts'

/** EventEmitter2 channel name for {@link TerminalOrdersExecutedEvent}. */
export const TERMINAL_ORDERS_EXECUTED = 'terminal.orders_executed'

export interface ExecutedOrderSummary {
  readonly orderId: number
  /** UAH kopecks. */
  readonly amount: number
  readonly status: OrderStatus
  readonly executionReason: OrderExecutionReason
}

/**
 * Emitted the moment the scraper confirms money in a jar and executes the
 * orders it settles.
 *
 * The existing `terminal.state_changed` channel deliberately stays silent for
 * scraper-driven executions — `OrderDbService.emitStateChanged` only fires for
 * PENDING, CANCELLED or ADMIN_PANEL — so there was no signal anywhere for "the
 * fiat actually arrived". That is precisely the moment a Mini App sale
 * has to react to, hence a dedicated channel rather than widening the old one,
 * which would change what the extension's history feed records.
 *
 * Travels through EventEmitter2 so the scraper stays unaware of the Mini App:
 * `BankScraperModule` must not depend on `TelegramMiniAppModule`, which already
 * depends on `TerminalModule` in the other direction.
 */
export class TerminalOrdersExecutedEvent {
  constructor(
    public readonly terminalId: number,
    public readonly traderId: number,
    public readonly cardId: number,
    public readonly orders: readonly ExecutedOrderSummary[],
    /** Jar balance after the match, UAH kopecks. */
    public readonly currentBalance: number
  ) {}
}
