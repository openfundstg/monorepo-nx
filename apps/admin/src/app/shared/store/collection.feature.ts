import {
  createAction,
  createFeatureSelector,
  createReducer,
  createSelector,
  on,
  props,
  type ActionReducer,
  type MemoizedSelector,
} from '@ngrx/store';
import {
  AdminSortDirection,
  type AdminPageReq,
  type AdminPaginatedRes,
  type ApiError,
} from '@transacto/contracts';
import { CollectionState, initialCollectionState } from './collection.state';

/**
 * One paginated list's actions, reducer and selectors, built from a name and an
 * identity function.
 *
 * Every list shares one implementation. The alternative — an actions file, a
 * reducer file and a selectors file per resource — is the same code a dozen
 * times over, and the copies drift: the paging arithmetic in the twelfth one is
 * the one that is off by a page.
 *
 * `createFeature` is deliberately not used. It derives its selector names from
 * a *literal* feature name, which a factory cannot supply, so the generic
 * version would hand back selectors typed as `unknown`. Hand-rolling the two
 * selectors costs four lines and keeps `T` all the way through.
 */

/** What a live socket push knows how to do to a list. */
export interface CollectionApi<T> {
  readonly actions: CollectionActions<T>;
  readonly reducer: ActionReducer<CollectionState<T>>;
  readonly selectors: CollectionSelectors<T>;
  readonly name: string;
  /**
   * How a row identifies itself — see {@link CollectionOptions.idOf}.
   *
   * Exposed because the table needs the same answer the reducer does. It was
   * captured in the closure and only the reducer could reach it, so the table
   * guessed instead, by taking its first column's value.
   */
  readonly idOf: (item: T) => string;
}

export interface CollectionSelectors<T> {
  readonly selectState: MemoizedSelector<Record<string, unknown>, CollectionState<T>>;
  readonly selectItems: MemoizedSelector<Record<string, unknown>, readonly T[]>;
  readonly selectLoading: MemoizedSelector<Record<string, unknown>, boolean>;
  readonly selectQuery: MemoizedSelector<Record<string, unknown>, AdminPageReq>;
}

export type CollectionActions<T> = ReturnType<typeof buildActions<T>>;

/**
 * Built with `createAction`, not `createActionGroup`.
 *
 * The group helper types its `source` as a string *literal* so it can name the
 * action types at compile time — which a factory taking a runtime name cannot
 * satisfy. The types are assembled by hand instead; they read identically in
 * the devtools and cost one line each.
 */
const buildActions = <T>(name: string) => ({
  /** The screen was opened. Loads unless the list is already populated. */
  entered: createAction(`[${name}] Entered`),
  /** Load with whatever query the state currently holds. */
  load: createAction(`[${name}] Load`),
  loadSuccess: createAction(`[${name}] Load Success`, props<{ res: AdminPaginatedRes<T> }>()),
  loadFailure: createAction(`[${name}] Load Failure`, props<{ error: ApiError }>()),
  searchChanged: createAction(`[${name}] Search Changed`, props<{ search: string }>()),
  /**
   * The operator narrowed the list — a chip, or the whole form at once.
   *
   * The map replaces what was there rather than merging into it, so clearing a
   * field clears it. A merge would make "remove this filter" impossible to
   * express without a second action for it.
   */
  filtersChanged: createAction(
    `[${name}] Filters Changed`,
    props<{ filters: Readonly<Record<string, string>> }>(),
  ),
  pageChanged: createAction(`[${name}] Page Changed`, props<{ page: number; limit: number }>()),
  sortChanged: createAction(
    `[${name}] Sort Changed`,
    props<{ sort: string | null; direction: AdminSortDirection }>(),
  ),
  /** A row arrived over the socket. */
  upserted: createAction(`[${name}] Upserted`, props<{ item: T }>()),
  /** The operator acted on the "N new rows" notice. */
  refreshed: createAction(`[${name}] Refreshed`),
});

export interface CollectionOptions<T> {
  /** Which field the list sorts by until the operator says otherwise. */
  readonly defaultSort: string | null;
  readonly defaultDirection?: AdminSortDirection;
  /**
   * What the list is narrowed to before anybody touches anything.
   *
   * Empty — the whole book — everywhere except where opening on everything
   * would bury the rows somebody came for.
   */
  readonly defaultFilters?: Readonly<Record<string, string>>;
  /**
   * How a row identifies itself.
   *
   * Used only to decide whether a pushed row replaces one already on screen —
   * see `pendingCount` on the state for what happens when it does not.
   */
  readonly idOf: (item: T) => string;
}

export const createCollection = <T>(
  name: string,
  options: CollectionOptions<T>,
): CollectionApi<T> => {
  const actions = buildActions<T>(name);
  const initial = initialCollectionState<T>(
    options.defaultSort,
    options.defaultDirection ?? AdminSortDirection.DESC,
    options.defaultFilters ?? {},
  );

  const reducer = createReducer(
    initial,
    on(actions.load, (state) => ({ ...state, loading: true, error: null })),
    on(actions.loadSuccess, (state, { res }) => ({
      ...state,
      items: res.items,
      total: res.total,
      page: res.page,
      limit: res.limit,
      loading: false,
      loaded: true,
      // The list on screen is now the list the server has, so whatever was
      // waiting behind the notice is included in it.
      pendingCount: 0,
    })),
    on(actions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
    // A new search starts at page one. Staying on page four of the previous
    // result set shows an empty table for a term that matched plenty.
    on(actions.searchChanged, (state, { search }) => ({ ...state, search, page: 1 })),
    // A narrower list starts at page one, for the same reason a search does:
    // page four of the whole book is rarely page four of one filter's worth.
    on(actions.filtersChanged, (state, { filters }) => ({ ...state, filters, page: 1 })),
    on(actions.pageChanged, (state, { page, limit }) => ({ ...state, page, limit })),
    on(actions.sortChanged, (state, { sort, direction }) => ({
      ...state,
      sort,
      direction,
      page: 1,
    })),
    on(actions.upserted, (state, { item }) => {
      const id = options.idOf(item);
      const index = state.items.findIndex((existing) => options.idOf(existing) === id);

      // Not on screen: it may belong on another page, or be excluded by the
      // search, or sort somewhere this client cannot work out. Counted rather
      // than inserted — see `pendingCount`.
      if (index === -1) return { ...state, pendingCount: state.pendingCount + 1 };

      return { ...state, items: state.items.with(index, item) };
    }),
  );

  const selectState = createFeatureSelector<CollectionState<T>>(name);

  return {
    name,
    actions,
    reducer,
    idOf: options.idOf,
    selectors: {
      selectState,
      selectItems: createSelector(selectState, (state) => state.items),
      selectLoading: createSelector(selectState, (state) => state.loading),
      selectQuery: createSelector(selectState, (state): AdminPageReq => ({
        page: state.page,
        limit: state.limit,
        search: state.search || undefined,
        // Spread, so a list with no filters sends none. Empty values never
        // reach here — the form drops them — because the backend refuses an
        // empty one, and a filter that matched nothing is what that refusal
        // exists to prevent.
        ...state.filters,
        sort: state.sort ?? undefined,
        direction: state.direction,
      })),
    } as CollectionSelectors<T>,
  };
};
