import { inject } from '@angular/core';
import type { AdminReferralEarningListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { ReferralsApiService } from '../services/referrals.api.service';

export const REFERRALS_FEATURE = 'referrals';

export const referralsCollection = createCollection<AdminReferralEarningListItem>(
  REFERRALS_FEATURE,
  {
    defaultSort: 'createdAt',
    idOf: (row) => row.id,
  },
);

const collectionEffects = createCollectionEffects(referralsCollection, () => {
  const api = inject(ReferralsApiService);

  return (query) => api.list(query);
});

export const referralsEffects = { ...collectionEffects };
