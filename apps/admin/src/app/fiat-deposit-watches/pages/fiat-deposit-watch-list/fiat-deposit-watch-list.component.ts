import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { bindListQuery } from '../../../shared/utils';
import { FIAT_DEPOSIT_WATCH_COLUMNS } from '../../constants/fiat-deposit-watches-columns.const';
import { fiatDepositWatchesCollection } from '../../store/fiat-deposit-watches.collection';

/**
 * What people are waiting for that the book has not offered them.
 *
 * Read-only on purpose — see the backend service. The screen answers one
 * question, and the sort on `lastNotifiedAt` sharpens it into the useful one:
 * which ranges have never once been filled.
 */
@Component({
  selector: 'app-fiat-deposit-watch-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './fiat-deposit-watch-list.component.html',
  styleUrl: './fiat-deposit-watch-list.component.scss',
})
export class FiatDepositWatchListComponent {
  private readonly store = inject(Store);

  readonly columns = FIAT_DEPOSIT_WATCH_COLUMNS;
  readonly state = this.store.selectSignal(fiatDepositWatchesCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = fiatDepositWatchesCollection.idOf;

  constructor() {
    bindListQuery(fiatDepositWatchesCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(fiatDepositWatchesCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(fiatDepositWatchesCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(fiatDepositWatchesCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(fiatDepositWatchesCollection.actions.refreshed());
  }
}
