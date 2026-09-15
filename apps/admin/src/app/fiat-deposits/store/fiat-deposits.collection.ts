import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type {
  AdminFiatDepositActionReq,
  AdminFiatDepositListItem,
  ApiError,
} from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { FiatDepositsApiService } from '../services/fiat-deposits.api.service';

export const FIAT_DEPOSITS_FEATURE = 'fiatDeposits';

export const fiatDepositsCollection = createCollection<AdminFiatDepositListItem>(
  FIAT_DEPOSITS_FEATURE,
  { defaultSort: 'createdAt', idOf: (row) => row.id },
);

export const fiatDepositActions = createActionGroup({
  source: 'Fiat Deposits',
  events: {
    Act: props<{ id: string; body: AdminFiatDepositActionReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(fiatDepositsCollection, () => {
  const api = inject(FiatDepositsApiService);

  return (query) => api.list(query);
});

/**
 * The stream this screen exists for.
 *
 * A top-up moves without anybody here touching it — a receipt lands, the hold
 * runs out, Transacto executes the payout — and the rows that matter most are
 * the ones that stop and wait for an operator. They arrive on their own.
 */
const live = createEffect(
  () =>
    inject(AdminSocketService)
      .fiatDepositUpdated()
      .pipe(map(({ fiatDeposit }) => fiatDepositsCollection.actions.upserted({ item: fiatDeposit }))),
  { functional: true },
);

/**
 * Crediting by hand, or giving the payout back.
 *
 * `exhaustMap`, so a second click while the first is in flight is dropped
 * rather than queued — both of these settle money, and the backend's own
 * conditional write should be the second line of defence, not the first.
 */
const act = createEffect(
  () => {
    const api = inject(FiatDepositsApiService);

    return inject(Actions).pipe(
      ofType(fiatDepositActions.act),
      exhaustMap(({ id, body }) =>
        api.act(id, body).pipe(
          map((item) => fiatDepositsCollection.actions.upserted({ item })),
          catchError((error: unknown) =>
            of(fiatDepositActions.failed({ error: toApiError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const fiatDepositsEffects = { ...collectionEffects, live, act };
