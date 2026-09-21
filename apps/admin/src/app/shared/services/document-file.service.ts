import { inject, Injectable } from '@angular/core';
import { AdminDocumentDisposition, type AdminDocumentListItem } from '@transacto/contracts';
import { AdminHttpService } from '../../core/services/admin-http.service';

/**
 * Where a document's bytes are — the one place that answers.
 *
 * Three screens ask: the archive, a sale's page and a deposit's page. That is
 * exactly why this is a service and not three inline template strings, and the
 * reason is on the record: the single link once assembled by hand asked for
 * `/api/admin/admin/card-orders/…` and was answered `404` — `environment.apiUrl`
 * already ends in `/admin` — so the only evidence for a disputed payment could
 * not be opened at all. Every path in this app now joins the base in exactly
 * one place, `AdminHttpService.url`, and this is the only builder of a document
 * path.
 *
 * It lives in `shared/services/` rather than in the archive's feature because
 * components may call a service and never an `*.api.service.ts`, and a
 * stateless thing used by three modules is what `shared/` is for.
 */
@Injectable({ providedIn: 'root' })
export class DocumentFileService {
  private readonly http = inject(AdminHttpService);

  /**
   * A URL the browser follows, not a request this app holds.
   *
   * **Inline by default.** These were always attachments, which meant an
   * operator checking whether a statement covered the right fortnight had to
   * download it, find it and open it — three steps to answer what a glance
   * answers. `ATTACHMENT` still files it, for the errand that is filing.
   */
  url(
    document: Pick<AdminDocumentListItem, 'kind' | 'id'>,
    disposition: AdminDocumentDisposition = AdminDocumentDisposition.INLINE,
  ): string {
    const path = `documents/${document.kind}/${document.id}/file`;

    return this.http.url(
      disposition === AdminDocumentDisposition.ATTACHMENT
        ? `${path}?disposition=${AdminDocumentDisposition.ATTACHMENT}`
        : path,
    );
  }
}
