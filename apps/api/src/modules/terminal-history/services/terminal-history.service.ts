import { Injectable, Inject, Logger } from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import { RedisKeys } from 'src/shared/redis/redis.keys'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import {
  TerminalHistoryDocument,
  TerminalHistoryOrderEvent,
  TerminalHistoryAlert
} from 'src/modules/repositories/terminal-history-db/schemas'

@Injectable()
export class TerminalHistoryService {
  private readonly logger = new Logger(TerminalHistoryService.name)

  constructor(
    private readonly terminalHistoryDbService: TerminalHistoryDbService,
    private readonly orderDbService: OrderDbService,
    private readonly terminalDbService: TerminalDbService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  @OnEvent('terminal.state_changed')
  async handleStateChanged(payload: {
    terminalId?: number
    cardId?: number
    context?: { orderEvents?: TerminalHistoryOrderEvent[]; alerts?: TerminalHistoryAlert[] }
  }) {
    try {
      let terminalId = payload.terminalId
      let cardId = payload.cardId
      let traderId: number | undefined

      // Each of these used to be a bare `return`. This listener is the end of
      // the webhook path — an order event reaches the extension's history
      // through here and nowhere else — so a silent drop looked exactly like
      // the backend ignoring webhooks altogether, which is precisely how it was
      // reported. Every exit now says which identifier it could not resolve.
      if (terminalId) {
        const terminal = await this.terminalDbService.findOne({ terminalId })
        if (!terminal) {
          this.logger.warn(
            `Dropping a state change for terminal ${terminalId}: no such terminal stored locally`
          )
          return
        }
        cardId = terminal.cardId
        traderId = terminal.traderId
      } else if (cardId) {
        const terminal = await this.terminalDbService.findOne({ cardId })
        if (!terminal) {
          // The likeliest of the three. Order webhooks carry only `card_id`,
          // and a card Transacto knows about is not necessarily one the
          // terminals sync has written here yet.
          this.logger.warn(
            `Dropping a state change for card_id ${cardId}: no terminal stored locally for it. ` +
              `The order event will not reach the extension's history.`
          )
          return
        }
        terminalId = terminal.terminalId
        traderId = terminal.traderId
      } else {
        this.logger.warn(
          'Dropping a state change that named neither a terminalId nor a cardId'
        )
        return
      }

      this.logger.debug(
        `State change for terminal ${terminalId} (card_id ${cardId}): ` +
          `${payload.context?.orderEvents?.length ?? 0} order event(s), ` +
          `${payload.context?.alerts?.length ?? 0} alert(s)`
      )

      const baselineKey = RedisKeys.Terminal.baseline(terminalId)
      const baselineStr = await this.redis.get(baselineKey)
      const baseline = baselineStr ? Number(baselineStr) : 0

      const currentKey = RedisKeys.Terminal.current(terminalId)
      const currentVal = await this.redis.get(currentKey)
      const balance = currentVal ? JSON.parse(currentVal).current : baseline

      await this.createLog(
        traderId,
        cardId,
        balance,
        baseline,
        0, // Delta is usually calculated later or not strictly used
        payload.context?.orderEvents || [],
        payload.context?.alerts || []
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.logger.error(`Failed to handle terminal state changed event: ${message}`)
    }
  }

  async createLog(
    traderId: number,
    cardId: number,
    balance: number,
    baseline: number,
    delta: number,
    orderEvents: TerminalHistoryOrderEvent[],
    alerts: TerminalHistoryAlert[]
  ): Promise<TerminalHistoryDocument> {
    const pendingOrders = await this.orderDbService.getPendingOrdersForCard(cardId)
    const pendingSum = pendingOrders.reduce((sum, o) => sum + o.amount, 0)
    const expectedBalance = baseline + pendingSum

    const savedLog = await this.terminalHistoryDbService.create({
      traderId,
      cardId,
      balance,
      baseline,
      expectedBalance,
      delta,
      orderEvents,
      alerts
    })

    this.emitHistoryUpdated(savedLog)

    return savedLog
  }

  /**
   * Was a `post('save')` schema hook. Moved here so persistence stays pure and
   * the emission is visible at the one call site that causes it. The payload
   * shape is unchanged and is typed by TerminalHistoryUpdatedDto in
   * @transacto/contracts.
   */
  private emitHistoryUpdated(doc: TerminalHistoryDocument): void {
    this.eventEmitter.emit(
      'ws.emit',
      new TraderWsEvent(doc.traderId, WsEventNames.TERMINAL_HISTORY_UPDATED, {
        _id: doc._id.toString(),
        cardId: doc.cardId,
        traderId: doc.traderId,
        balance: doc.balance,
        baseline: doc.baseline,
        expectedBalance: doc.expectedBalance,
        delta: doc.delta,
        orderEvents: doc.orderEvents,
        alerts: doc.alerts,
        timestamp: doc.timestamp,
        createdAt: doc.createdAt
      })
    )
  }
}
