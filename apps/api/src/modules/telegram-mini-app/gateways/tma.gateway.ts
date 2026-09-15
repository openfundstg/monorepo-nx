import { Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { createHmac } from 'crypto'
import environments from 'src/environments'
import { TmaWsEventNames } from '@transacto/contracts'
import type {
  DepositStatusEvent,
  SaleStatusEvent,
  SaleProgressEvent,
  BalanceUpdateEvent,
  ReferralBalanceUpdateEvent,
  FiatDepositStatusEvent
} from '@transacto/contracts'
import { TmaDepositStatus } from 'src/modules/repositories/tma-deposit-db/schemas'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type {
  TmaBalanceChangedEvent,
  TmaDepositChangedEvent,
  TmaFiatDepositChangedEvent,
  TmaSaleChangedEvent
} from 'src/shared/interfaces'

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/tma' })
export class TmaGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TmaGateway.name)

  @WebSocketServer()
  server: Server

  /**
   * Announces the same movements on an internal channel, for observers that are
   * not this user's socket.
   *
   * The admin panel is the one today. It subscribes rather than being called,
   * so nothing here needs to know it exists — see {@link TMA_DOMAIN_EVENT}.
   */
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async handleConnection(client: Socket) {
    try {
      const initData = client.handshake.query['initData'] as string
      if (!initData) {
        this.logger.warn(`Client ${client.id} rejected: no initData`)
        client.disconnect(true)
        return
      }

      const telegramId = this.validateAndExtractTelegramId(initData)
      if (!telegramId) {
        this.logger.warn(`Client ${client.id} rejected: invalid initData`)
        client.disconnect(true)
        return
      }

      const room = this.room(telegramId)
      await client.join(room)
      this.logger.log(`Client ${client.id} joined room ${room}`)
    } catch (error) {
      this.logger.error(`Connection error for ${client.id}: ${error}`)
      client.disconnect(true)
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`)
  }

  emitDepositStatusChange(telegramId: number, depositId: string, status: TmaDepositStatus): void {
    const payload: DepositStatusEvent = { depositId, status }
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.DEPOSIT_STATUS_CHANGED, payload)
    this.announce<TmaDepositChangedEvent>(TMA_DOMAIN_EVENT.DEPOSIT_STATUS_CHANGED, {
      telegramId,
      depositId,
      status
    })
  }

  /**
   * A fiat top-up moved.
   *
   * Takes the whole event rather than a status because these advance without
   * changing status: a receipt accepted against a large payout leaves it
   * PARTIALLY_PAID and still moves the progress the user is watching.
   */
  emitFiatDepositStatusChange(telegramId: number, payload: FiatDepositStatusEvent): void {
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.FIAT_DEPOSIT_STATUS_CHANGED, payload)
    this.announce<TmaFiatDepositChangedEvent>(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STATUS_CHANGED, {
      telegramId,
      ...payload
    })
  }

  emitSaleStatusChange(
    telegramId: number,
    orderId: string,
    status: TmaSaleStatus
  ): void {
    const payload: SaleStatusEvent = { orderId, status }
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.SALE_STATUS_CHANGED, payload)
    this.announce<TmaSaleChangedEvent>(TMA_DOMAIN_EVENT.SALE_STATUS_CHANGED, {
      telegramId,
      saleId: orderId,
      status
    })
  }

  /**
   * Pushes a complete progress snapshot, not a delta — see
   * {@link SaleProgressService} for why.
   */
  emitSaleProgress(telegramId: number, progress: SaleProgressEvent): void {
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.SALE_PROGRESS, progress)
    this.announce<TmaSaleChangedEvent>(TMA_DOMAIN_EVENT.SALE_PROGRESS, {
      telegramId,
      saleId: progress.saleId,
      status: progress.status
    })
  }

  emitBalanceUpdated(telegramId: number, newBalance: number): void {
    const payload: BalanceUpdateEvent = { balance: newBalance }
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.BALANCE_UPDATED, payload)
    this.announce<TmaBalanceChangedEvent>(TMA_DOMAIN_EVENT.BALANCE_UPDATED, { telegramId })
  }

  /**
   * Announces a move on the referral pot.
   *
   * Kept apart from {@link emitBalanceUpdated} because the two balances are not
   * interchangeable: a payout raises this one without making a single cent more
   * spendable, so a client that merged them would offer money for a sale
   * that the server would then refuse.
   */
  emitReferralBalanceUpdated(telegramId: number, payload: ReferralBalanceUpdateEvent): void {
    this.server.to(this.room(telegramId)).emit(TmaWsEventNames.REFERRAL_BALANCE_UPDATED, payload)
    this.announce<TmaBalanceChangedEvent>(TMA_DOMAIN_EVENT.REFERRAL_BALANCE_UPDATED, { telegramId })
  }

  /**
   * One room per Telegram user, joined at handshake. There is no per-order room:
   * a user watches at most a handful of orders and filtering client-side costs
   * nothing, whereas per-order rooms would need join/leave plumbing on every
   * navigation.
   */
  private room(telegramId: number): string {
    return `tma:${telegramId}`
  }

  /**
   * Publishes on the internal channel, never letting a listener's failure reach
   * the caller.
   *
   * Every call site here is a money path that has already committed — the
   * balance moved, the order settled — and an observer throwing must not turn
   * that into a 500 for the user whose money it was. EventEmitter2 is
   * synchronous, so without this a listener's exception would propagate
   * straight back into the emitter.
   */
  private announce<T>(event: string, payload: T): void {
    try {
      this.eventEmitter.emit(event, payload)
    } catch (error: unknown) {
      this.logger.error(
        `Failed to announce ${event}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Lightweight initData validation for WebSocket handshake.
   * Returns the telegramId if valid, null otherwise.
   */
  private validateAndExtractTelegramId(initData: string): number | null {
    try {
      const params = new URLSearchParams(initData)
      const hash = params.get('hash')
      if (!hash) return null

      params.delete('hash')

      const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
      const dataCheckString = sortedEntries.map(([k, v]) => `${k}=${v}`).join('\n')

      const botToken = environments.TELEGRAM_BOT_TOKEN
      if (!botToken) return null

      const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
      const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

      if (computedHash !== hash) return null

      const userJson = params.get('user')
      if (!userJson) return null

      const user = JSON.parse(userJson)
      return user.id ? Number(user.id) : null
    } catch {
      return null
    }
  }
}
