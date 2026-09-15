import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type { AdminAlertActionReq, AdminAlertListItem, ApiError } from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { toApiError } from '../../shared/utils';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { AlertsApiService } from '../services/alerts.api.service';

export const ALERTS_FEATURE = 'alerts';

export const alertsCollection = createCollection<AdminAlertListItem>(ALERTS_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

export const alertActions = createActionGroup({
  source: 'Alerts',
  events: {
    Resolve: props<{ id: string; body: AdminAlertActionReq }>(),
    Delete: props<{ id: string; body: AdminAlertActionReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(alertsCollection, () => {
  const api = inject(AlertsApiService);

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
      .alertUpdated()
      .pipe(map(({ alert }) => alertsCollection.actions.upserted({ item: alert }))),
  { functional: true },
);

/**
 * Resolving patches the row in place; deleting cannot, so it reloads.
 *
 * The collection can replace a row and can count one it has never seen, but it
 * has no concept of a row that is gone — and inventing one would mean a second
 * way for the list and the server to disagree about what exists. A reload after
 * a delete is one request and is always right.
 */
const resolve = createEffect(
  () => {
    const api = inject(AlertsApiService);

    return inject(Actions).pipe(
      ofType(alertActions.resolve),
      exhaustMap(({ id, body }) =>
        api.resolve(id, body).pipe(
          map((alert) => alertsCollection.actions.upserted({ item: alert })),
          catchError((error: unknown) => of(alertActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

const remove = createEffect(
  () => {
    const api = inject(AlertsApiService);

    return inject(Actions).pipe(
      ofType(alertActions.delete),
      exhaustMap(({ id, body }) =>
        api.remove(id, body).pipe(
          map(() => alertsCollection.actions.refreshed()),
          catchError((error: unknown) => of(alertActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const alertsEffects = { ...collectionEffects, live, resolve, remove };
