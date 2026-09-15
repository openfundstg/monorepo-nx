import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { DEPOSIT_COLUMNS } from '../../constants/deposits-columns.const';
import { depositsCollection } from '../../store/deposits.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-deposits-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './deposits-list.component.html',
  styleUrl: './deposits-list.component.scss',
})
export class DepositsListComponent {
  private readonly store = inject(Store);

  readonly columns = DEPOSIT_COLUMNS;
  readonly state = this.store.selectSignal(depositsCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(depositsCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(depositsCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(depositsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(depositsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(depositsCollection.actions.refreshed());
  }
}
