import { inject, Injectable } from '@angular/core';
import type {
  AdminDocumentListItem,
  AdminPageReq,
  AdminPaginatedRes,
} from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/**
 * HTTP only.
 *
 * One method, because a document's *bytes* are not a request this app makes —
 * they are a link the browser follows, and `DocumentFileService` in `shared/`
 * is the only builder of that link. Three screens offer it, and the one time a
 * path like it was written out by hand it asked for `/api/admin/admin/…`.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsApiService {
  private readonly http = inject(AdminHttpService);

  list(query: AdminPageReq): Observable<AdminPaginatedRes<AdminDocumentListItem>> {
    return this.http.list<AdminDocumentListItem>('documents', query);
  }
}
