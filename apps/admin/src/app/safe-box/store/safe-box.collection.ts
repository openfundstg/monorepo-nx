import { inject } from '@angular/core';
import type { AdminSafeBoxListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { SafeBoxApiService } from '../services/safe-box.api.service';

export const SAFE_BOX_FEATURE = 'safeBox';

export const safeBoxCollection = createCollection<AdminSafeBoxListItem>(SAFE_BOX_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

const collectionEffects = createCollectionEffects(safeBoxCollection, () => {
  const api = inject(SafeBoxApiService);

  return (query) => api.list(query);
});

export const safeBoxEffects = { ...collectionEffects };
