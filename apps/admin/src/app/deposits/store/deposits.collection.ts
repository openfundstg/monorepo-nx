import { inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import type { AdminDepositListItem } from '@transacto/contracts';
import { map } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { DepositsApiService } from '../services/deposits.api.service';

export const DEPOSITS_FEATURE = 'deposits';

export const depositsCollection = createCollection<AdminDepositListItem>(DEPOSITS_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

const collectionEffects = createCollectionEffects(depositsCollection, () => {
  const api = inject(DepositsApiService);

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
      .depositUpdated()
      .pipe(map(({ deposit }) => depositsCollection.actions.upserted({ item: deposit }))),
  { functional: true },
);

export const depositsEffects = { ...collectionEffects, live };
