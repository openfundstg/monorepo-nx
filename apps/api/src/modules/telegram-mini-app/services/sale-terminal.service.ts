import { Injectable } from '@nestjs/common'
import { TmaServiceTraderService } from 'src/modules/telegram-mini-app/services/tma-service-trader.service'
import { TerminalActivationService, TerminalDeactivationService } from 'src/modules/terminal'

/** The identifiers a teardown needs, and nothing else. */
export interface DisposableTerminal {
  readonly publicId: string
  readonly cardId: number | null
  readonly traderId: number | null
  readonly transactoTerminalId: number | null
}

/**
 * Takes a sale's terminal out of service.
 *
 * Every way a sale ends — completed, blocked, cancelled — ends here,
 * and what happens next is {@link TerminalDeactivationService}'s: telling
 * Transacto, archiving the credential, clearing the jar-full warning, writing
 * Mongo and clearing Redis, in that order and with those failure semantics.
 * This class exists only to turn a sale into that request — it knows
 * which token to use and what the order settled for, and nothing else does.
 *
 * It used to carry the teardown itself, one of three copies that had quietly
 * drifted apart. See `TerminalDeactivationService` for what the differences
 * were and which of them was intentional.
 */
@Injectable()
export class SaleTerminalService {
  constructor(
    private readonly deactivation: TerminalDeactivationService,
    private readonly activation: TerminalActivationService,
    private readonly serviceTrader: TmaServiceTraderService
  ) {}

  /**
   * Stands the terminal down. Never throws.
   *
   * By the time this runs the order is already settled — the money has moved,
   * or deliberately has not — so a Transacto hiccup must not surface as a failed
   * completion or cost a user a refund they were already owed.
   *
   * `context` names the ending in every log line the teardown writes.
   * `settledKopecks` is passed only by a completion; see
   * {@link TerminalDeactivation.settledKopecks}.
   */
  /**
   * Stops new payers being routed here, leaving the terminal in service.
   *
   * For an order the user asked to end while payments were still outstanding.
   * See {@link TerminalDeactivationService.stopRouting} for why the terminal
   * must keep being scraped rather than switched off.
   */
  async stopRouting(order: DisposableTerminal, context: string): Promise<void> {
    const { cardId, traderId, transactoTerminalId } = order
    if (cardId === null || traderId === null) return

    const { apiToken } = await this.serviceTrader.resolve()

    await this.deactivation.stopRouting({
      terminalId: transactoTerminalId,
      traderId,
      cardId,
      reason: `${context} order ${order.publicId}`,
      apiToken
    })
  }

  async disable(
    order: DisposableTerminal,
    context: string,
    settledKopecks?: number
  ): Promise<void> {
    const { cardId, traderId, transactoTerminalId } = order
    if (cardId === null || traderId === null) return

    // Resolved here rather than inside the deactivation service: the Mini App's
    // terminals belong to one service trader, and which token stands them down
    // is a fact about this feature rather than about deactivating a terminal.
    const { apiToken } = await this.serviceTrader.resolve()

    await this.deactivation.deactivate({
      terminalId: transactoTerminalId,
      traderId,
      cardId,
      reason: `${context} order ${order.publicId}`,
      apiToken,
      settledKopecks
    })
  }

  /**
   * Brings the terminal back into service.
   *
   * The mirror of {@link disable}, and possible only because a teardown never
   * deletes the credential — it stands it down, which is reversible.
   *
   * **Throws where `disable` swallows**, and the difference is who is waiting.
   * A teardown runs after the money has already moved, so a Transacto hiccup
   * must not cost a user a refund they were owed. This runs because an operator
   * asked for it and is watching the answer; telling them the terminal is back
   * when it is not would leave an order marked live that no payer can reach.
   */
  async enable(order: DisposableTerminal, context: string): Promise<void> {
    const { cardId, traderId } = order
    if (cardId === null || traderId === null) return

    const { apiToken } = await this.serviceTrader.resolve()

    await this.activation.activate({
      traderId,
      cardId,
      reason: `${context} order ${order.publicId}`,
      apiToken
    })
  }
}
