import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { SAFE_BOX_COLUMNS } from '../../constants/safe-box-columns.const';
import { safeBoxCollection } from '../../store/safe-box.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-safe-box-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './safe-box-list.component.html',
  styleUrl: './safe-box-list.component.scss',
})
export class SafeBoxListComponent {
  private readonly store = inject(Store);

  readonly columns = SAFE_BOX_COLUMNS;
  readonly state = this.store.selectSignal(safeBoxCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(safeBoxCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(safeBoxCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(safeBoxCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(safeBoxCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(safeBoxCollection.actions.refreshed());
  }
}
