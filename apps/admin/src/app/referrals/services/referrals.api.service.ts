import { inject, Injectable } from '@angular/core';
import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminReferralEarningListItem,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class ReferralsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminReferralEarningListItem>> {
    return this.http.list<AdminReferralEarningListItem>('referrals', query);
  }
}
