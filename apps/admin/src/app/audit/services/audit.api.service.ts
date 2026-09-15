import { inject, Injectable } from '@angular/core';
import type { AdminPageReq, AdminPaginatedRes, AdminAuditLogItem } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminAuditLogItem>> {
    return this.http.list<AdminAuditLogItem>('audit', query);
  }
}
