import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { extractSendId } from 'src/shared/utils'
import { TerminalStateCacheService } from './terminal-state-cache.service'
import { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'

/**
 * Pushes a terminal's card to the extension the moment its orders change.
 *
 * The trader watches `pendingOrdersSum` to know how much money is on its way
 * into a jar, and that number only ever moved when the scraper happened to come
 * round — see the note on the emit site in `OrderDbService`. This closes the
 * gap: an `order.created` or `order.cancelled` webhook now refreshes the card
 * directly, in the same request, rather than waiting for a poll that may be
 * seconds away or not running at all.
 *
 * It reads the balance rather than measuring it. No bank is contacted here: the
 * figures come from whatever was last observed, and the only thing this event
 * actually changes is the pending sum. A cheap event that fires per order must
 * not become a scrape.
 */
@Injectable()
export class TerminalOrdersBroadcastListener {
  private readonly logger = new Logger(TerminalOrdersBroadcastListener.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly terminalStateCache: TerminalStateCacheService,
    private readonly orchestrator: TerminalBalanceOrchestratorService
  ) {}

  @OnEvent('terminal.orders_changed')
  async handleOrdersChanged(payload: { cardId?: number }): Promise<void> {
    const { cardId } = payload

    if (!cardId) {
      this.logger.warn('Orders changed for no card id; nothing to broadcast')
      return
    }

    try {
      const terminal = await this.terminalDbService.findOne({ cardId })
      if (!terminal) {
        // The same drop the history listener reports, for the same reason:
        // order webhooks carry only `card_id`, and a card Transacto knows is
        // not necessarily one the terminals sync has written here yet.
        this.logger.warn(
          `Orders changed for card_id ${cardId} but no terminal is stored for it; ` +
            `the dashboard will not see the new pending total`
        )
        return
      }

      if (!terminal.enabled) {
        // The dashboard shows enabled terminals only, and the client's store
        // *adds* a card for a balance event whose terminal it does not already
        // hold. Broadcasting for a switched-off jar — a stale order finally
        // being cancelled, say — would therefore make it reappear on the
        // dashboard out of nowhere and stay until the next refresh. A disabled
        // terminal is not being polled and takes no new orders, so there is
        // nothing live to report anyway; it is found through the search
        // endpoint instead.
        this.logger.debug(
          `Orders changed for terminal ${terminal.terminalId}, which is disabled; not broadcasting`
        )
        return
      }

      // Redis first, the persisted copy behind it. `current` expires after an
      // hour and is deleted outright when a terminal is deactivated, so a jar
      // that is off — or simply quiet — has only the stored figures left.
      const state = await this.terminalStateCache.getCurrentState(terminal.terminalId)
      const balance = state?.current ?? terminal.lastBalance ?? 0
      const goal = state?.goal ?? terminal.lastGoal ?? undefined

      await this.orchestrator.broadcastBalanceUpdate(
        terminal.terminalId,
        terminal.traderId,
        terminal.cardId,
        terminal.terminalName,
        extractSendId(terminal.cred3) || '',
        balance,
        goal
      )
    } catch (error: unknown) {
      // Swallowed on purpose. This runs off the back of an order write, and a
      // failure to refresh a number on a screen must never be able to undo one.
      this.logger.error(
        `Could not broadcast the new pending total for card_id ${cardId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
