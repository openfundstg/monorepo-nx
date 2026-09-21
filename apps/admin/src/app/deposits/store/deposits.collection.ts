import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type {
  AdminDepositRowItem,
  AdminFiatDepositActionReq,
  ApiError,
} from '@transacto/contracts';
import { catchError, exhaustMap, map, merge, of } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { DepositsApiService } from '../services/deposits.api.service';

export const DEPOSITS_FEATURE = 'deposits';

export const depositsCollection = createCollection<AdminDepositRowItem>(DEPOSITS_FEATURE, {
  defaultSort: 'createdAt',
  /**
   * **Kind and id, not id.**
   *
   * The two rails are different collections minting their own ObjectIds, and
   * nothing stops one from matching the other. An identity of `id` alone would
   * let a crypto deposit's push overwrite a fiat top-up's row — rarely, and
   * unreproducibly, which is the worst way for a bug about somebody's money to
   * behave.
   */
  idOf: (row) => `${row.kind}:${row.id}`,
});

export const depositActions = createActionGroup({
  source: 'Deposits',
  events: {
    Act: props<{ id: string; body: AdminFiatDepositActionReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(depositsCollection, () => {
  const api = inject(DepositsApiService);

  return (query) => api.list(query);
});

/**
 * Both rails' pushes, into one list.
 *
 * Two event names because two different things in the product move; one
 * `upserted` because the panel shows one book. The payloads are already the
 * same shape — see `AdminDepositUpdatedEvent` — so nothing is converted here.
 */
const liveDeposits = createEffect(
  () => {
    const socket = inject(AdminSocketService);

    return merge(socket.depositUpdated(), socket.fiatDepositUpdated()).pipe(
      map(({ deposit }) => depositsCollection.actions.upserted({ item: deposit })),
    );
  },
  { functional: true },
);

/**
 * Credit a top-up by hand, or give its payout back.
 *
 * `exhaustMap`, so a second click while the first is in flight is dropped
 * rather than queued — each of these settles money, and the backend's own
 * conditional write should be the second line of defence, not the first.
 */
const act = createEffect(
  () => {
    const api = inject(DepositsApiService);

    return inject(Actions).pipe(
      ofType(depositActions.act),
      exhaustMap(({ id, body }) =>
        api.act(id, body).pipe(
          map((deposit) => depositsCollection.actions.upserted({ item: deposit })),
          catchError((error: unknown) => of(depositActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const depositsEffects = { ...collectionEffects, liveDeposits, act };
