import { Injectable, signal, inject, OnDestroy } from '@angular/core'
import { io, Socket } from 'socket.io-client'
import { TmaService } from '../../auth/services/tma.service'
import { TmaWsEventNames } from '@transacto/contracts'
import type {
  DepositStatusEvent,
  SaleStatusEvent,
  SaleProgressEvent,
  BalanceUpdateEvent,
  ReferralBalanceUpdateEvent,
  FiatDepositStatusEvent
} from '@transacto/contracts'
import { environment } from '../../../environments/environment'

// Re-exported for existing consumers; the shapes are owned by @transacto/contracts.
export type {
  DepositStatusEvent,
  SaleStatusEvent,
  SaleProgressEvent,
  BalanceUpdateEvent,
  ReferralBalanceUpdateEvent,
  FiatDepositStatusEvent
}

/**
 * The one socket the Mini App owns, on the `/tma` namespace.
 *
 * Every event latches into a signal rather than being pushed through a Subject:
 * a component that mounts *after* an event still reads the last value, which is
 * exactly the case the status page hits when a push lands during navigation.
 * A non-replaying bus would drop it silently.
 */
@Injectable({ providedIn: 'root' })
export class WsService implements OnDestroy {
  private readonly tmaService = inject(TmaService)

  private socket: Socket | null = null

  readonly depositStatusChanged = signal<DepositStatusEvent | null>(null)
  /**
   * The last fiat top-up movement.
   *
   * Its own signal rather than a second use of {@link depositStatusChanged}:
   * the two carry different ids into different collections, and a screen
   * reading the wrong one would poll for a top-up that does not exist.
   */
  readonly fiatDepositStatusChanged = signal<FiatDepositStatusEvent | null>(null)
  readonly saleStatusChanged = signal<SaleStatusEvent | null>(null)
  readonly saleProgress = signal<SaleProgressEvent | null>(null)
  readonly balanceUpdated = signal<BalanceUpdateEvent | null>(null)
  /**
   * The referral pot, which moves independently of `balanceUpdated`: a payout
   * raises it without making a cent more spendable.
   */
  readonly referralBalanceUpdated = signal<ReferralBalanceUpdateEvent | null>(null)
  readonly connected = signal(false)

  /**
   * Incremented on every `connect`, including reconnects.
   *
   * `connected()` only answers "is the socket up *now*", which is not enough:
   * anything the server emitted while the socket was down is gone forever —
   * socket.io replays nothing. A page that renders live state must therefore
   * re-fetch its snapshot whenever this number changes past the first
   * connection, or a single dropped frame leaves a permanent hole on screen.
   */
  readonly connectionEpoch = signal(0)

  connect(): void {
    const initData = this.tmaService.initData()
    if (!initData || this.socket) return

    this.socket = io(`${environment.wsUrl}/tma`, {
      query: { initData },
      transports: ['websocket']
    })

    this.socket.on('connect', () => {
      this.connected.set(true)
      this.connectionEpoch.update((epoch) => epoch + 1)
    })

    this.socket.on('disconnect', () => {
      this.connected.set(false)
    })

    this.socket.on(
      TmaWsEventNames.FIAT_DEPOSIT_STATUS_CHANGED,
      (data: FiatDepositStatusEvent) => {
        this.fiatDepositStatusChanged.set(data)
      }
    )

    this.socket.on(TmaWsEventNames.DEPOSIT_STATUS_CHANGED, (data: DepositStatusEvent) => {
      this.depositStatusChanged.set({ ...data })
    })

    this.socket.on(TmaWsEventNames.SALE_STATUS_CHANGED, (data: SaleStatusEvent) => {
      this.saleStatusChanged.set({ ...data })
    })

    // A complete snapshot, not a delta — consumers replace their state with it.
    // The room is per-user, so snapshots for the user's *other* orders arrive
    // here too; filtering by `saleId` is the consumer's job.
    this.socket.on(TmaWsEventNames.SALE_PROGRESS, (data: SaleProgressEvent) => {
      this.saleProgress.set({ ...data })
    })

    this.socket.on(TmaWsEventNames.BALANCE_UPDATED, (data: BalanceUpdateEvent) => {
      this.balanceUpdated.set({ ...data })
    })

    this.socket.on(
      TmaWsEventNames.REFERRAL_BALANCE_UPDATED,
      (data: ReferralBalanceUpdateEvent) => {
        this.referralBalanceUpdated.set({ ...data })
      }
    )
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.connected.set(false)
  }

  ngOnDestroy(): void {
    this.disconnect()
  }
}
