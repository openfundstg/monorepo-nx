import { inject, Injectable } from '@angular/core';
import type {
  AdminAdjustBalanceReq,
  AdminAdjustBalanceRes,
  AdminPageReq,
  AdminPaginatedRes,
  AdminSetUserActiveReq,
  AdminTmaUserDetailRes,
  AdminTmaUserListItem,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. Every decision lives in the effects and the components. */
@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminTmaUserListItem>> {
    return this.http.list<AdminTmaUserListItem>('users', query);
  }

  detail(telegramId: number): Observable<AdminTmaUserDetailRes> {
    return this.http.get<AdminTmaUserDetailRes>(`users/${telegramId}`);
  }

  setActive(telegramId: number, body: AdminSetUserActiveReq): Observable<AdminTmaUserListItem> {
    return this.http.command<AdminSetUserActiveReq, AdminTmaUserListItem>(
      `users/${telegramId}/active`,
      body,
    );
  }

  adjustBalance(
    telegramId: number,
    body: AdminAdjustBalanceReq,
  ): Observable<AdminAdjustBalanceRes> {
    return this.http.command<AdminAdjustBalanceReq, AdminAdjustBalanceRes>(
      `users/${telegramId}/balance`,
      body,
    );
  }
}
