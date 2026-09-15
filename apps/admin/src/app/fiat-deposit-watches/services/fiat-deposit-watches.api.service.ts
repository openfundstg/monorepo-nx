import { inject, Injectable } from '@angular/core';
import type {
  AdminFiatDepositWatchListItem,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. One method, because the list carries no actions. */
@Injectable({ providedIn: 'root' })
export class FiatDepositWatchesApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminFiatDepositWatchListItem>> {
    return this.http.list<AdminFiatDepositWatchListItem>('fiat-deposit-watches', query);
  }
}
