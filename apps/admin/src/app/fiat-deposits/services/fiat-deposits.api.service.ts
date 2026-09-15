import { inject, Injectable } from '@angular/core';
import type {
  AdminFiatDepositActionReq,
  AdminFiatDepositListItem,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class FiatDepositsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminFiatDepositListItem>> {
    return this.http.list<AdminFiatDepositListItem>('fiat-deposits', query);
  }

  act(id: string, body: AdminFiatDepositActionReq): Observable<AdminFiatDepositListItem> {
    return this.http.command<AdminFiatDepositActionReq, AdminFiatDepositListItem>(
      `fiat-deposits/${id}/action`,
      body,
    );
  }
}
