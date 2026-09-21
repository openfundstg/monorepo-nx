import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import type { CollectionApi } from '../store';

/**
 * Opens a list, applying whatever the URL asked for.
 *
 * **This is what makes a cross-link mean anything.** A chip on a sale that says
 * "3 orders" is only useful if following it lands on the orders list *already
 * filtered to that terminal* — otherwise it is a link to a haystack with a
 * note about which needle. So every link this panel builds carries `search`
 * and `filter` as query parameters, and every list reads them here.
 *
 * **Absent parameters change nothing**, which is the other half of the rule. A
 * list already in the store keeps its search and its chip when an operator
 * navigates away and back, exactly as it did before — the URL only overrides
 * when it actually says something. Clearing on absence would make the sidebar
 * a reset button that nothing labels as one.
 *
 * Subscribed rather than read from the snapshot: Angular reuses a component
 * when only the query string changes, so a second link into the list an
 * operator is already on would otherwise do nothing at all.
 */
export const bindListQuery = <T>(collection: CollectionApi<T>): void => {
  const store = inject(Store);
  const route = inject(ActivatedRoute);
  const destroyRef = inject(DestroyRef);

  route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
    const search = params.get('search');
    const filter = params.get('filter');

    if (search !== null) store.dispatch(collection.actions.searchChanged({ search }));
    if (filter !== null) store.dispatch(collection.actions.filterChanged({ filter }));

    // **Only when the URL said nothing.** Both actions above already end in a
    // load — `filterChanged` immediately, `searchChanged` after the typing
    // debounce — so sending `entered` as well would fetch the same page twice,
    // and the second answer would arrive after the first had already painted.
    if (search === null && filter === null) store.dispatch(collection.actions.entered());
  });
};
