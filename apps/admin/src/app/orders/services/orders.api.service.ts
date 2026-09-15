import { inject, Injectable } from '@angular/core';
import type { AdminPageReq, AdminPaginatedRes, AdminOrderListItem } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminOrderListItem>> {
    return this.http.list<AdminOrderListItem>('orders', query);
  }
}
