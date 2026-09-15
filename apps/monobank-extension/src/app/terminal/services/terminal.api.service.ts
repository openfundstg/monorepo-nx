import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  SaleRemainderPolicy,
  TerminalSearchRes,
  TerminalSource,
} from '@transacto/contracts';
import type { AlertData } from '../interfaces/terminal.interface';

/** Raw dashboard row, before it is mapped onto `Terminal`. */
export interface DashboardTerminalRes {
  readonly terminalId: number;
  readonly cardId: number;
  readonly sendId?: string;
  readonly terminalName?: string;
  readonly bankProvider?: string;
  readonly source?: TerminalSource;
  readonly url?: string;
  readonly balance: number;
  readonly goal?: number;
  readonly hasPendingOrders?: boolean;
  readonly pendingOrdersSum?: number;
  readonly enabled?: boolean;
  /**
   * Whether new payers are still routed here.
   *
   * Distinct from `enabled`, and a jar winding down is the case that separates
   * them: still watched, still able to receive, but taking nobody new.
   */
  readonly acceptingOrders?: boolean;
  /** Absent on a terminal the trader created themselves. */
  readonly remainderPolicy?: SaleRemainderPolicy;
  /** When the balance was observed — not when this response was built. */
  readonly balanceAt?: string;
  readonly updatedAt?: string;
}

export interface DashboardRes {
  readonly terminals: DashboardTerminalRes[];
  readonly alerts: AlertData[];
}

export interface TerminalHistoryRes {
  readonly success: boolean;
  readonly history: unknown[];
}

/** Transport only — every decision lives in `TerminalService` or the pages. */
@Injectable({ providedIn: 'root' })
export class TerminalApiService {
  private readonly http = inject(HttpClient);

  getDashboard(): Observable<DashboardRes> {
    return this.http.get<DashboardRes>(`${environment.apiUrl}/extension/dashboard`);
  }

  getHistory(cardId: number): Observable<TerminalHistoryRes> {
    return this.http.get<TerminalHistoryRes>(
      `${environment.apiUrl}/extension/dashboard/history/${cardId}`,
    );
  }

  /**
   * Terminal search across everything the trader owns, disabled jars included.
   *
   * The dashboard payload only ever carries live terminals, so this is the one
   * call that can reach a switched-off one. `q` is sent verbatim; ranking —
   * exact name match first — is the server's, and the order of the response is
   * the order to render.
   */
  searchTerminals(q: string, limit?: number): Observable<TerminalSearchRes> {
    return this.http.get<TerminalSearchRes>(`${environment.apiUrl}/extension/terminals/search`, {
      params: limit ? { q, limit } : { q },
    });
  }

  sync(terminalId: number): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/extension/terminals/${terminalId}/sync`, {});
  }
}
