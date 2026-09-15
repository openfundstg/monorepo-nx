import { AdminSortDirection, type AdminPaginatedRes } from '@transacto/contracts';
import { describe, expect, it } from 'vitest';
import { createCollection } from './collection.feature';
import { initialCollectionState } from './collection.state';

interface Row {
  readonly id: string;
  readonly value: number;
}

const collection = createCollection<Row>('test', {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

const { actions, reducer } = collection;
const initial = initialCollectionState<Row>('createdAt');

const page = (items: Row[], total = items.length): AdminPaginatedRes<Row> => ({
  items,
  total,
  page: 1,
  limit: 25,
});

describe('collection reducer', () => {
  it('replaces the rows and clears the pending notice on a successful load', () => {
    const withPending = { ...initial, pendingCount: 3 };
    const state = reducer(withPending, actions.loadSuccess({ res: page([{ id: 'a', value: 1 }]) }));

    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    // The list on screen is now the server's list, so whatever was waiting
    // behind the notice is already included in it.
    expect(state.pendingCount).toBe(0);
  });

  it('returns to page one on a new search', () => {
    // Staying on page four of the previous result set shows an empty table for
    // a term that matched plenty — which reads as "no results".
    const onPageFour = reducer(initial, actions.pageChanged({ page: 4, limit: 25 }));
    const searched = reducer(onPageFour, actions.searchChanged({ search: 'oleg' }));

    expect(searched.page).toBe(1);
    expect(searched.search).toBe('oleg');
  });

  it('returns to page one when the sort changes', () => {
    const onPageFour = reducer(initial, actions.pageChanged({ page: 4, limit: 25 }));
    const sorted = reducer(
      onPageFour,
      actions.sortChanged({ sort: 'balance', direction: AdminSortDirection.ASC }),
    );

    expect(sorted.page).toBe(1);
    expect(sorted.sort).toBe('balance');
    expect(sorted.direction).toBe(AdminSortDirection.ASC);
  });

  it('replaces a live row that is on screen, in place', () => {
    const loaded = reducer(
      initial,
      actions.loadSuccess({
        res: page([
          { id: 'a', value: 1 },
          { id: 'b', value: 2 },
        ]),
      }),
    );

    const patched = reducer(loaded, actions.upserted({ item: { id: 'b', value: 99 } }));

    expect(patched.items).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 99 },
    ]);
    // Replacing a visible row is not a new row, so nothing is pending.
    expect(patched.pendingCount).toBe(0);
  });

  it('counts a live row that is not on screen instead of inserting it', () => {
    // Where a new row belongs — under this search, this sort, on this page —
    // is a question only the server can answer. Inventing a position puts the
    // row in the wrong place and shifts every row after it.
    const loaded = reducer(
      initial,
      actions.loadSuccess({ res: page([{ id: 'a', value: 1 }], 90) }),
    );
    const pushed = reducer(loaded, actions.upserted({ item: { id: 'z', value: 5 } }));

    expect(pushed.items).toHaveLength(1);
    expect(pushed.pendingCount).toBe(1);
  });

  it('does not mutate the rows it replaces', () => {
    const rows = [{ id: 'a', value: 1 }];
    const loaded = reducer(initial, actions.loadSuccess({ res: page(rows) }));
    const patched = reducer(loaded, actions.upserted({ item: { id: 'a', value: 2 } }));

    expect(rows[0].value).toBe(1);
    expect(patched.items).not.toBe(loaded.items);
  });

  it('stops loading and keeps the error on a failure', () => {
    const loading = reducer(initial, actions.load());
    expect(loading.loading).toBe(true);

    const failed = reducer(loading, actions.loadFailure({ error: { code: 500, message: 'x' } }));
    expect(failed.loading).toBe(false);
    expect(failed.error?.code).toBe(500);
  });
});

describe('collection query selector', () => {
  it('omits an empty search rather than sending one that matches nothing', () => {
    const query = collection.selectors.selectQuery.projector(initial);

    expect(query.search).toBeUndefined();
    expect(query.page).toBe(1);
  });

  it('carries the search once there is one', () => {
    const state = reducer(initial, actions.searchChanged({ search: 'Z38SL69F' }));

    expect(collection.selectors.selectQuery.projector(state).search).toBe('Z38SL69F');
  });
});
