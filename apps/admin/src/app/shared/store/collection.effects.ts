import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';
import { type AdminPageReq, type AdminPaginatedRes } from '@transacto/contracts';
import { debounceTime, map, of, switchMap, type Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { toApiError } from '../utils/api-error.util';
import type { CollectionApi } from './collection.feature';

/** How long typing settles before a search hits the server. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The load effect every list shares.
 *
 * Takes the collection built by `createCollection` and a factory that resolves
 * the API call — a factory rather than the call itself because it is invoked
 * inside Angular's injection context, which is the only place `inject()` works.
 *
 * **Every query-changing action funnels into one load.** Search, paging and
 * sorting all end in the same request built from the same state, so the
 * parameters cannot disagree with what the screen is showing — which is what
 * happens when each control assembles its own query.
 *
 * `switchMap`, not `concatMap`: a search that has been typed past is a response
 * nobody wants, and letting it land would repaint the table with stale rows
 * after the current one has already arrived.
 */
export const createCollectionEffects = <T>(
  collection: CollectionApi<T>,
  loaderFactory: () => (query: AdminPageReq) => Observable<AdminPaginatedRes<T>>,
) => {
  const { actions, selectors } = collection;

  return {
    /**
     * Opening the screen loads it, but only once.
     *
     * A list already in the store stays as it is — navigating away and back
     * should not throw away rows that a live push has since kept current.
     */
    enter: createEffect(
      () => {
        const store = inject(Store);

        return inject(Actions).pipe(
          ofType(actions.entered),
          concatLatestFrom(() => store.select(selectors.selectState)),
          map(([, state]) => (state.loaded ? actions.refreshed() : actions.load())),
        );
      },
      { functional: true },
    ),

    /**
     * Typing is debounced; everything else is immediate.
     *
     * Two streams rather than one debounced stream over all of them: a
     * quarter-second lag on a page-forward click reads as a broken button,
     * while a request per keystroke is a request per keystroke.
     */
    search: createEffect(
      () =>
        inject(Actions).pipe(
          ofType(actions.searchChanged),
          debounceTime(SEARCH_DEBOUNCE_MS),
          map(() => actions.load()),
        ),
      { functional: true },
    ),

    paging: createEffect(
      () =>
        inject(Actions).pipe(
          ofType(actions.pageChanged, actions.sortChanged, actions.refreshed),
          map(() => actions.load()),
        ),
      { functional: true },
    ),

    load: createEffect(
      () => {
        const store = inject(Store);
        const load = loaderFactory();

        return inject(Actions).pipe(
          ofType(actions.load),
          concatLatestFrom(() => store.select(selectors.selectQuery)),
          switchMap(([, query]) =>
            load(query).pipe(
              map((res) => actions.loadSuccess({ res })),
              catchError((error: unknown) => of(actions.loadFailure({ error: toApiError(error) }))),
            ),
          ),
        );
      },
      { functional: true },
    ),
  };
};
