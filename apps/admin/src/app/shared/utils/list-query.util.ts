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

    // **Everything else is a filter**, whatever it is called. A link built by
    // `links.util.ts` may narrow by a chip, a person or a date, and listing the
    // names here would mean a link nobody could follow until this file learnt
    // about it. The destination's own DTO is what decides whether a parameter
    // means anything; an unknown one is refused there, loudly, rather than
    // dropped here, silently.
    const filters = Object.fromEntries(
      params.keys.filter((key) => key !== 'search').map((key) => [key, params.get(key) ?? '']),
    );

    if (search !== null) store.dispatch(collection.actions.searchChanged({ search }));
    if (Object.keys(filters).length > 0)
      store.dispatch(collection.actions.filtersChanged({ filters }));

    // **Only when the URL said nothing.** Both actions above already end in a
    // load — `filtersChanged` immediately, `searchChanged` after the typing
    // debounce — so sending `entered` as well would fetch the same page twice,
    // and the second answer would arrive after the first had already painted.
    if (search === null && Object.keys(filters).length === 0)
      store.dispatch(collection.actions.entered());
  });
};
