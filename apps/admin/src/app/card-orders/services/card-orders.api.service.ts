import { inject, Injectable } from '@angular/core';
import type {
  AdminCardOrderListItem,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/**
 * HTTP only. One method, because this screen settles nothing.
 *
 * Appeals are closed in Transacto's own panel by hand, by deliberate decision —
 * what the panel offers is the evidence to close them with. Hence the download,
 * which is a link rather than a request: a PDF the browser should save, not a
 * body this app would have to hold.
 */
@Injectable({ providedIn: 'root' })
export class CardOrdersApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminCardOrderListItem>> {
    return this.http.list<AdminCardOrderListItem>('card-orders', query);
  }

  /**
   * Where the statement for one order can be downloaded.
   *
   * Addressed by Transacto's order number, because that is what an operator
   * arrives from their panel holding — and the same reason the search box takes
   * one. The cookie the panel already carries authenticates it, which is why
   * this can be an ordinary link.
   */
  statementUrl(orderId: number): string {
    return this.http.url(`card-orders/${orderId}/statement`);
  }
}
