import { inject, Injectable } from '@angular/core';
import type {
  AdminAlertActionReq,
  AdminAlertListItem,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class AlertsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminAlertListItem>> {
    return this.http.list<AdminAlertListItem>('alerts', query);
  }

  resolve(id: string, body: AdminAlertActionReq): Observable<AdminAlertListItem> {
    return this.http.command<AdminAlertActionReq, AdminAlertListItem>(`alerts/${id}/resolve`, body);
  }

  /**
   * Deleting carries a body — the reason is the only thing that outlives the
   * row, so it cannot ride in the query string where every access log would
   * keep a copy of it.
   */
  remove(id: string, body: AdminAlertActionReq): Observable<void> {
    return this.http.remove<AdminAlertActionReq>(`alerts/${id}`, body);
  }
}
