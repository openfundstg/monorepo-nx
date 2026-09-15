import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { TerminalStateCacheService } from './terminal-state-cache.service'

/**
 * How long an unchanged terminal may stay silent.
 *
 * **Coupled to `Polling.STALE_AFTER_MS` in the extension** — that is what lights
 * the trader's "polling" indicator, and it must exceed the worst-case gap
 * between two broadcasts:
 *
 *     heartbeat 15s + poll interval and jitter 7.5s + bank timeout 10s = 32.5s
 *
 * The extension allows 45s. Raise that first if this ever grows: a client on the
 * older threshold reads the longer silence as a dead terminal.
 */
const BROADCAST_HEARTBEAT_MS = 15_000

@Injectable()
export class TerminalBalanceOrchestratorService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly terminalStateCache: TerminalStateCacheService
  ) {}

  /**
   * Pushes a terminal's balance to its trader's extension.
   *
   * Identical consecutive updates are dropped. The scraper polls every ~5s per
   * terminal regardless of activity, so without this an idle trader with nine
   * terminals receives a couple of events per second forever, none of which
   * change anything on screen.
   */
  async broadcastBalanceUpdate(
    terminalId: number,
    traderId: number,
    cardId: number,
    terminalName: string,
    sendId: string,
    currentBalance: number,
    goal?: number
  ): Promise<void> {
    const pendingOrders = await this.trackedOrderDbService.getPendingOrdersForCard(cardId)
    const hasPendingOrders = pendingOrders.length > 0
    const pendingOrdersSum = pendingOrders.reduce((sum, order) => sum + order.amount, 0)

    // Everything the trader can actually see. `updatedAt` is deliberately absent
    // — including a timestamp would make every signature unique.
    const signature = `${currentBalance}|${goal ?? ''}|${hasPendingOrders}|${pendingOrdersSum}|${terminalName}|${sendId}`

    const worthSending = await this.terminalStateCache.shouldBroadcast(
      terminalId,
      signature,
      BROADCAST_HEARTBEAT_MS
    )
    if (!worthSending) return

    this.eventEmitter.emit(
      'ws.emit',
      new TraderWsEvent(traderId, WsEventNames.TERMINAL_BALANCE_UPDATED, {
        terminalId,
        cardId,
        sendId,
        terminalName,
        currentBalance,
        goal,
        hasPendingOrders,
        pendingOrdersSum,
        updatedAt: Date.now()
      })
    )
  }
}
