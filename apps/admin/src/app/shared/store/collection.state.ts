import { AdminSortDirection, type ApiError } from '@transacto/contracts';

/**
 * The state behind one paginated list.
 *
 * Every list in the panel has exactly this shape, which is what makes one
 * reducer, one set of effects and one table component enough for all of them. A
 * per-resource store would be the same forty lines a dozen times, and the last
 * copy is where the paging arithmetic goes wrong.
 */
export interface CollectionState<T> {
  readonly items: readonly T[];
  /** Rows matching the current filter, which is usually more than `items.length`. */
  readonly total: number;
  /** One-based, as the API takes it and as the paginator shows it. */
  readonly page: number;
  readonly limit: number;
  readonly search: string;
  /**
   * The one named slice this list is showing, or `null` for all of it.
   *
   * A single string rather than a filter object, because every list that has
   * more than one slice has exactly one axis of them and an operator picks one
   * chip — see `AdminPageReq.filter`. A list with no slices leaves this `null`
   * forever and never sends it.
   */
  readonly filter: string | null;
  readonly sort: string | null;
  readonly direction: AdminSortDirection;
  readonly loading: boolean;
  readonly error: ApiError | null;
  /**
   * Rows that arrived over the socket and do not belong to what is on screen.
   *
   * A live push replaces a row it can find and counts it here when it cannot —
   * because "where does this new user belong in a list sorted by balance,
   * filtered by a search term, on page three?" has no answer the client can work
   * out. Inventing one puts a row in the wrong place and shifts every row after
   * it; counting it lets the screen offer a refresh, which is the honest
   * version of the same thing.
   */
  readonly pendingCount: number;
  /** Whether the first load for this screen has finished, so skeletons show once. */
  readonly loaded: boolean;
}

/** How many rows a list asks for before anyone touches the paginator. */
export const DEFAULT_PAGE_LIMIT = 25;

export const initialCollectionState = <T>(
  sort: string | null,
  direction: AdminSortDirection = AdminSortDirection.DESC,
  filter: string | null = null,
): CollectionState<T> => ({
  items: [],
  total: 0,
  page: 1,
  limit: DEFAULT_PAGE_LIMIT,
  search: '',
  filter,
  sort,
  direction,
  loading: false,
  error: null,
  pendingCount: 0,
  loaded: false,
});
