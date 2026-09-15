import { inject, Injectable } from '@angular/core';
import type { AdminPageReq, AdminPaginatedRes, AdminSafeBoxListItem } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class SafeBoxApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminSafeBoxListItem>> {
    return this.http.list<AdminSafeBoxListItem>('safe-box', query);
  }
}
