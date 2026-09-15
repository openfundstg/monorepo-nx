import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type { AdminSetTraderActiveReq, AdminTraderListItem, ApiError } from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { TradersApiService } from '../services/traders.api.service';

export const TRADERS_FEATURE = 'traders';

export const tradersCollection = createCollection<AdminTraderListItem>(TRADERS_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (trader) => trader.id,
});

export const traderActions = createActionGroup({
  source: 'Traders',
  events: {
    'Set Active': props<{ traderId: number; body: AdminSetTraderActiveReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(tradersCollection, () => {
  const api = inject(TradersApiService);

  return (query) => api.list(query);
});

/**
 * No live stream, and that is a decision rather than an omission.
 *
 * A trader row is an account plus two counts, and nothing about it moves
 * without somebody acting — the counts change when a terminal or an alert does,
 * and both have their own screen. Subscribing here would mean recomputing two
 * aggregations on every scrape in the system to keep a rarely-open list
 * current.
 */
const setActive = createEffect(
  () => {
    const api = inject(TradersApiService);

    return inject(Actions).pipe(
      ofType(traderActions.setActive),
      exhaustMap(({ traderId, body }) =>
        api.setActive(traderId, body).pipe(
          map((trader) => tradersCollection.actions.upserted({ item: trader })),
          catchError((error: unknown) => of(traderActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const tradersEffects = { ...collectionEffects, setActive };
