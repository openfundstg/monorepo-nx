import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type {
  AdminSaleActionReq,
  AdminSaleListItem,
  ApiError,
} from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { SalesApiService } from '../services/sales.api.service';

export const SALES_FEATURE = 'sales';

export const salesCollection = createCollection<AdminSaleListItem>(
  SALES_FEATURE,
  { defaultSort: 'createdAt', idOf: (order) => order.id },
);

export const saleActions = createActionGroup({
  source: 'Sales',
  events: {
    Act: props<{ id: string; body: AdminSaleActionReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(salesCollection, () => {
  const api = inject(SalesApiService);

  return (query) => api.list(query);
});

/**
 * The stream this screen exists for.
 *
 * A running order's `receivedAmount` and `jarBalance` move as payers land money
 * in the jar, and the backend already pushes a full snapshot for the user's own
 * status page — this subscribes to the admin fan-out of the same thing, so the
 * list moves without anybody refreshing it.
 */
const liveOrders = createEffect(
  () =>
    inject(AdminSocketService)
      .saleUpdated()
      .pipe(map(({ order }) => salesCollection.actions.upserted({ item: order }))),
  { functional: true },
);

/**
 * Cancel, block or complete.
 *
 * `exhaustMap`, so a second click while the first is in flight is dropped
 * rather than queued — each of these settles money, and the backend's own
 * idempotency gate should be the second line of defence, not the first.
 */
const act = createEffect(
  () => {
    const api = inject(SalesApiService);

    return inject(Actions).pipe(
      ofType(saleActions.act),
      exhaustMap(({ id, body }) =>
        api.act(id, body).pipe(
          map((order) => salesCollection.actions.upserted({ item: order })),
          catchError((error: unknown) =>
            of(saleActions.failed({ error: toApiError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const salesEffects = { ...collectionEffects, liveOrders, act };
