import { inject, Injectable } from '@angular/core';
import type {
  AdminDepositDetailRes,
  AdminDepositKind,
  AdminDepositRowItem,
  AdminFiatDepositActionReq,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class DepositsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminDepositRowItem>> {
    return this.http.list<AdminDepositRowItem>('deposits', query);
  }

  detail(kind: AdminDepositKind, id: string): Observable<AdminDepositDetailRes> {
    return this.http.get<AdminDepositDetailRes>(`deposits/${kind}/${id}`);
  }

  /**
   * The one write in this book, and only on the hryvnia rail.
   *
   * The path names `FIAT` rather than taking the kind, because a crypto deposit
   * has no equivalent intervention — see the controller's note.
   */
  act(id: string, body: AdminFiatDepositActionReq): Observable<AdminDepositRowItem> {
    return this.http.command<AdminFiatDepositActionReq, AdminDepositRowItem>(
      `deposits/FIAT/${id}/action`,
      body,
    );
  }
}
