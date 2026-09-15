import { inject } from '@angular/core';
import type { AdminFiatDepositWatchListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { FiatDepositWatchesApiService } from '../services/fiat-deposit-watches.api.service';

export const FIAT_DEPOSIT_WATCHES_FEATURE = 'fiatDepositWatches';

export const fiatDepositWatchesCollection = createCollection<AdminFiatDepositWatchListItem>(
  FIAT_DEPOSIT_WATCHES_FEATURE,
  { defaultSort: 'createdAt', idOf: (row) => row.id },
);

const collectionEffects = createCollectionEffects(fiatDepositWatchesCollection, () => {
  const api = inject(FiatDepositWatchesApiService);

  return (query) => api.list(query);
});

/**
 * No live effect and no action effect.
 *
 * A request changes when its owner opens the Mini App, which is neither
 * frequent nor urgent to see — and nothing here writes, so there is no second
 * settlement path to keep in step. Refresh is the button on the table.
 */
export const fiatDepositWatchesEffects = { ...collectionEffects };
