import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminCardOrderListItem, AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import type { RowActionEvent } from '../../../shared/components';
import type { RowAction } from '../../../shared/interfaces';
import { CARD_ORDER_COLUMNS } from '../../constants/card-orders-columns.const';
import { CardOrdersApiService } from '../../services/card-orders.api.service';
import { cardOrdersCollection } from '../../store/card-orders.collection';

/** The one thing this screen does, beyond showing the queue. */
const OPEN_STATEMENT = 'openStatement';

/**
 * Card payments a seller says never arrived.
 *
 * **Built for one errand.** A dispute is worked in Transacto's own panel, where
 * the order is a number and nothing else — no sale id, no seller, no code. An
 * operator arrives here with that number, types it into the search box, and
 * gets the seller, the amount they denied and the document they sent about it.
 *
 * **It settles nothing**, and that is deliberate rather than unfinished:
 * appeals are closed in Transacto's panel, and a second settlement path for the
 * same money is what this panel's rules forbid. What this offers is the
 * evidence to close them with.
 */
@Component({
  selector: 'app-card-order-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './card-order-list.component.html',
  styleUrl: './card-order-list.component.scss',
})
export class CardOrderListComponent {
  private readonly store = inject(Store);
  private readonly api = inject(CardOrdersApiService);

  readonly columns = CARD_ORDER_COLUMNS;
  readonly state = this.store.selectSignal(cardOrdersCollection.selectors.selectState);

  /**
   * Opening the statement, and only where there is one.
   *
   * The predicate is the row's own count rather than a rule restated here: a
   * menu item that answers `404` is worse than one that is not drawn.
   */
  readonly actions: readonly RowAction<AdminCardOrderListItem>[] = [
    {
      id: OPEN_STATEMENT,
      label: 'card_orders.open_statement',
      icon: 'description',
      visible: (row) => row.statements.length > 0,
    },
  ];

  constructor() {
    this.store.dispatch(cardOrdersCollection.actions.entered());
  }

  /**
   * Hands the document to the browser to save.
   *
   * A navigation rather than a request: it is a PDF an operator files against
   * an appeal, and the endpoint sends it as an attachment. The session cookie
   * the panel already carries is what authenticates it — which works only
   * because the panel is served from the API's own origin.
   */
  onAction(event: RowActionEvent<AdminCardOrderListItem>): void {
    if (event.actionId !== OPEN_STATEMENT) return;

    window.location.assign(this.api.statementUrl(event.row.orderId));
  }

  onSearch(search: string): void {
    this.store.dispatch(cardOrdersCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(cardOrdersCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(cardOrdersCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(cardOrdersCollection.actions.refreshed());
  }

}
