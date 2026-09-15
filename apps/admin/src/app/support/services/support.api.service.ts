import { inject, Injectable } from '@angular/core';
import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminSupportTopicListItem,
  AdminSupportUserListItem,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class SupportApiService {
  private readonly http = inject(AdminHttpService);

  listTopics(query: AdminPageReq): Observable<AdminPaginatedRes<AdminSupportTopicListItem>> {
    return this.http.list<AdminSupportTopicListItem>('support/topics', query);
  }

  listUsers(query: AdminPageReq): Observable<AdminPaginatedRes<AdminSupportUserListItem>> {
    return this.http.list<AdminSupportUserListItem>('support/users', query);
  }
}
