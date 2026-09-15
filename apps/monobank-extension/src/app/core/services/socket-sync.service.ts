import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  WsEventNames,
  type TerminalAlertResolvedDto,
  type TerminalAlertTriggeredDto,
  type TerminalBalanceUpdatedDto,
  type TerminalDisabledDto,
  type TerminalEnabledDto,
  type TraderDeactivatedDto,
} from '@transacto/contracts';
import { SocketService } from './socket.service';
import { SessionService } from './session.service';
import { TerminalService } from '../../terminal/services/terminal.service';
import { toTerminal } from '../../terminal/services/terminal-loader.service';
import type { AlertData } from '../../terminal/interfaces/terminal.interface';

/**
 * The bridge from live backend events to the terminal store.
 *
 * Instantiated once at bootstrap by `provideAppInitializer`; it has no public
 * surface because nothing calls it — it only listens.
 */
@Injectable({ providedIn: 'root' })
export class SocketSyncService implements OnDestroy {
  private readonly socketService = inject(SocketService);
  private readonly terminalService = inject(TerminalService);
  private readonly session = inject(SessionService);

  private readonly subs = new Subscription();

  constructor() {
    this.setupListeners();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private setupListeners(): void {
    this.listen<TerminalBalanceUpdatedDto>(WsEventNames.TERMINAL_BALANCE_UPDATED, (dto) =>
      this.terminalService.updateTerminalBalance(dto),
    );

    this.listen<TerminalAlertTriggeredDto>(WsEventNames.TERMINAL_ALERT_TRIGGERED, (dto) =>
      this.terminalService.addAlert(dto as unknown as AlertData),
    );

    this.listen<TerminalAlertResolvedDto>(WsEventNames.TERMINAL_ALERT_RESOLVED, (dto) => {
      if (dto.alertId) this.terminalService.removeAlert(dto.alertId);
    });

    this.listen<TerminalDisabledDto>(WsEventNames.TERMINAL_DISABLED, (dto) => {
      if (dto.terminalId) this.terminalService.disableTerminalAndCheckRemoval(dto.terminalId);
    });

    // Mapped through the same function the dashboard payload goes through —
    // the two carry the same shape on purpose, and one mapper is what keeps a
    // live card and a reloaded one identical.
    this.listen<TerminalEnabledDto>(WsEventNames.TERMINAL_ENABLED, (dto) =>
      this.terminalService.enableOrAddTerminal(toTerminal(dto)),
    );

    this.listen<TraderDeactivatedDto>(WsEventNames.TRADER_DEACTIVATED, (dto) => {
      // The server has revoked this trader — drop the session and the terminals
      // it described, or the popup keeps showing data the token can no longer read.
      const currentTraderId = this.session.traderId();
      if (currentTraderId && String(currentTraderId) === String(dto.traderId)) {
        console.warn('Trader deactivated by server. Logging out...');
        this.terminalService.clear();
        void this.session.clear();
      }
    });
  }

  private listen<T>(event: WsEventNames, handle: (dto: T) => void): void {
    this.subs.add(this.socketService.on<T>(event).subscribe(handle));
  }
}
