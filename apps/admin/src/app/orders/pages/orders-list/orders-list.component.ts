import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { ORDER_COLUMNS } from '../../constants/orders-columns.const';
import { ordersCollection } from '../../store/orders.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-orders-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './orders-list.component.html',
  styleUrl: './orders-list.component.scss',
})
export class OrdersListComponent {
  private readonly store = inject(Store);

  readonly columns = ORDER_COLUMNS;
  readonly state = this.store.selectSignal(ordersCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(ordersCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(ordersCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(ordersCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(ordersCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(ordersCollection.actions.refreshed());
  }
}
