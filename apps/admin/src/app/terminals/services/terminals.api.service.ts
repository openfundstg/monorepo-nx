import { inject, Injectable } from '@angular/core';
import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminSetTerminalStateReq,
  AdminTerminalHistoryItem,
  AdminTerminalListItem,
} from '@transacto/contracts';
import { firstValueFrom, type Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class TerminalsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminTerminalListItem>> {
    return this.http.list<AdminTerminalListItem>('terminals', query);
  }

  /** Keyed by `cardId` — every terminal has one, and `terminalId` may be null. */
  setState(cardId: number, body: AdminSetTerminalStateReq): Observable<AdminTerminalListItem> {
    return this.http.command<AdminSetTerminalStateReq, AdminTerminalListItem>(
      `terminals/${cardId}/state`,
      body,
    );
  }

  /**
   * The scraper's audit trail for one jar, newest first.
   *
   * Keyed by `cardId` because that is the identifier every terminal has —
   * `terminalId` is `null` on one that never reached Transacto — and it is what
   * history rows are filed under.
   */
  async history(
    cardId: number,
    query: AdminPageReq,
  ): Promise<AdminPaginatedRes<AdminTerminalHistoryItem>> {
    return firstValueFrom(
      this.http.list<AdminTerminalHistoryItem>(`terminals/${cardId}/history`, query),
    );
  }
}
