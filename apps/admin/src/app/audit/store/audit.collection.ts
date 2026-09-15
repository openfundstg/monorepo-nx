import { inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import type { AdminAuditLogItem } from '@transacto/contracts';
import { map } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { AuditApiService } from '../services/audit.api.service';

export const AUDIT_FEATURE = 'audit';

export const auditCollection = createCollection<AdminAuditLogItem>(AUDIT_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

const collectionEffects = createCollectionEffects(auditCollection, () => {
  const api = inject(AuditApiService);

  return (query) => api.list(query);
});

/**
 * The live half — the same rows the product already announces, patched into the
 * list in place. See `CollectionState.pendingCount` for what happens to a row
 * that does not belong on screen.
 */
const live = createEffect(
  () =>
    inject(AdminSocketService)
      .auditLogged()
      .pipe(map(({ entry }) => auditCollection.actions.upserted({ item: entry }))),
  { functional: true },
);

export const auditEffects = { ...collectionEffects, live };
