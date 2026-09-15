import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AdminWsEventNames } from '@transacto/contracts';
import type {
  AdminAlertUpdatedEvent,
  TerminalHistoryUpdatedDto,
  AdminAuditLoggedEvent,
  AdminDepositUpdatedEvent,
  AdminFiatDepositUpdatedEvent,
  AdminSaleUpdatedEvent,
  AdminTerminalUpdatedEvent,
  AdminUserUpdatedEvent,
} from '@transacto/contracts';
import { io, type Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * The one socket the panel holds, on the backend's `/admin` namespace.
 *
 * **It carries no credential of its own.** The handshake is authenticated by
 * the `admin_session` cookie, which the browser attaches to the upgrade request
 * because that cookie is scoped to `/` — deliberately wider than the CSRF
 * cookie, precisely so this works. Script cannot read an `HttpOnly` cookie, so
 * there is no token to pass by hand and nothing here to leak.
 *
 * Connection is driven by the auth state rather than by a component: the socket
 * outlives every screen, and a component that opened it would close it on
 * navigation.
 */
@Injectable({ providedIn: 'root' })
export class AdminSocketService {
  private readonly destroyRef = inject(DestroyRef);
  private socket: Socket | null = null;

  /** Shown in the shell, so an operator can tell "quiet" from "disconnected". */
  readonly connected = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  connect(): void {
    if (this.socket) return;

    this.socket = io(`${environment.wsUrl}${environment.wsNamespace}`, {
      // Same-origin, so the cookie rides along by default — but Socket.IO's
      // polling transport uses XHR, which drops cookies unless told otherwise
      // the moment the panel is ever served from anywhere else.
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  readonly userUpdated = (): Observable<AdminUserUpdatedEvent> =>
    this.on<AdminUserUpdatedEvent>(AdminWsEventNames.USER_UPDATED);

  readonly saleUpdated = (): Observable<AdminSaleUpdatedEvent> =>
    this.on<AdminSaleUpdatedEvent>(AdminWsEventNames.SALE_UPDATED);

  readonly depositUpdated = (): Observable<AdminDepositUpdatedEvent> =>
    this.on<AdminDepositUpdatedEvent>(AdminWsEventNames.DEPOSIT_UPDATED);

  readonly fiatDepositUpdated = (): Observable<AdminFiatDepositUpdatedEvent> =>
    this.on<AdminFiatDepositUpdatedEvent>(AdminWsEventNames.FIAT_DEPOSIT_UPDATED);

  readonly terminalUpdated = (): Observable<AdminTerminalUpdatedEvent> =>
    this.on<AdminTerminalUpdatedEvent>(AdminWsEventNames.TERMINAL_UPDATED);

  readonly alertUpdated = (): Observable<AdminAlertUpdatedEvent> =>
    this.on<AdminAlertUpdatedEvent>(AdminWsEventNames.ALERT_UPDATED);

  /**
   * Scraper history rows, for every terminal.
   *
   * Unfiltered on purpose — there is no per-terminal room, so the history
   * screen filters by `cardId` itself. An operator watches one jar at a time,
   * and rooms per terminal would need join/leave plumbing on every navigation
   * for a stream that is a handful of rows a minute.
   */
  readonly terminalHistoryAppended = (): Observable<TerminalHistoryUpdatedDto> =>
    this.on<TerminalHistoryUpdatedDto>(AdminWsEventNames.TERMINAL_HISTORY_APPENDED);

  readonly auditLogged = (): Observable<AdminAuditLoggedEvent> =>
    this.on<AdminAuditLoggedEvent>(AdminWsEventNames.AUDIT_LOGGED);

  /**
   * One event name as a stream that survives reconnects.
   *
   * The handler is registered against whichever socket exists when a value
   * arrives rather than being captured once, so a subscriber taken out during a
   * disconnect keeps receiving after the socket comes back. The teardown
   * removes only this listener, so two subscribers to the same event do not
   * unregister each other.
   */
  private on<T>(event: AdminWsEventNames): Observable<T> {
    return new Observable<T>((subscriber) => {
      const handler = (payload: T) => subscriber.next(payload);

      this.connect();
      this.socket?.on(event, handler);

      return () => {
        this.socket?.off(event, handler);
      };
    });
  }
}
