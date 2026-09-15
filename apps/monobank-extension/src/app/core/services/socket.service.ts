import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { WsEventNames } from '@transacto/contracts';
import { environment } from '../../../environments/environment';
import { SessionService } from './session.service';
import { TerminalLoaderService } from '../../terminal/services/terminal-loader.service';

/**
 * The live connection to the backend, opened and closed by the session.
 *
 * Every known `WsEventNames` is forwarded onto one bus; `SocketSyncService`
 * subscribes to the individual events. Keeping the fan-out here means the
 * socket library is referenced in exactly one file.
 */
@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private readonly session = inject(SessionService);
  private readonly terminalLoader = inject(TerminalLoaderService);

  readonly isConnected = signal<boolean>(false);

  private socket: Socket | null = null;
  private readonly eventBus$ = new Subject<{ event: string; data: unknown }>();

  constructor() {
    effect(() => {
      const token = this.session.token();

      if (token && !this.socket) void this.hydrateAndConnect(token);
      else if (!token && this.socket) this.disconnect();
    });
  }

  on<T>(event: string): Observable<T> {
    return this.eventBus$.asObservable().pipe(
      filter((e) => e.event === event),
      map((e) => e.data as T),
    );
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.eventBus$.complete();
  }

  /**
   * REST first, socket second — deliberately.
   *
   * The dashboard load is the only source of terminals that have not changed
   * recently; connecting first would leave a window where an incoming balance
   * event creates a near-empty card that the load then overwrites.
   */
  private async hydrateAndConnect(token: string): Promise<void> {
    await this.terminalLoader.hydrateInitialState();
    this.connect(token);
  }

  private connect(token: string): void {
    this.socket = io(`${environment.wsUrl}/extension`, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.isConnected.set(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.isConnected.set(false);
    });

    for (const eventName of Object.values(WsEventNames)) {
      this.socket.on(eventName, (data: unknown) => this.eventBus$.next({ event: eventName, data }));
    }
  }

  private disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.isConnected.set(false);
  }
}
