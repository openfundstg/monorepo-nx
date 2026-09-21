import { inject, Injectable } from '@angular/core';
import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminSaleActionReq,
  AdminSaleDetailRes,
  AdminSaleListItem,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class SalesApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminSaleListItem>> {
    return this.http.list<AdminSaleListItem>('sales', query);
  }

  detail(id: string): Observable<AdminSaleDetailRes> {
    return this.http.get<AdminSaleDetailRes>(`sales/${id}`);
  }

  act(id: string, body: AdminSaleActionReq): Observable<AdminSaleListItem> {
    return this.http.command<AdminSaleActionReq, AdminSaleListItem>(
      `sales/${id}/action`,
      body,
    );
  }
}
