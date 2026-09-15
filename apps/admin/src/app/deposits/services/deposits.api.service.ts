import { inject, Injectable } from '@angular/core';
import type { AdminPageReq, AdminPaginatedRes, AdminDepositListItem } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class DepositsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminDepositListItem>> {
    return this.http.list<AdminDepositListItem>('deposits', query);
  }
}
