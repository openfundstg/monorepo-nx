import { inject, Injectable } from '@angular/core';
import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminSetTraderActiveReq,
  AdminTraderListItem,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class TradersApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminTraderListItem>> {
    return this.http.list<AdminTraderListItem>('traders', query);
  }

  setActive(traderId: number, body: AdminSetTraderActiveReq): Observable<AdminTraderListItem> {
    return this.http.command<AdminSetTraderActiveReq, AdminTraderListItem>(
      `traders/${traderId}/active`,
      body,
    );
  }
}
