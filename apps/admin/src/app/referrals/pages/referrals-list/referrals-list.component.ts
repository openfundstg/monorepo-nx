import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { bindListQuery } from '../../../shared/utils';
import { REFERRAL_COLUMNS } from '../../constants/referrals-columns.const';
import { referralsCollection } from '../../store/referrals.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-referrals-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './referrals-list.component.html',
  styleUrl: './referrals-list.component.scss',
})
export class ReferralsListComponent {
  private readonly store = inject(Store);

  readonly columns = REFERRAL_COLUMNS;
  readonly state = this.store.selectSignal(referralsCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = referralsCollection.idOf;

  constructor() {
    bindListQuery(referralsCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(referralsCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(referralsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(referralsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(referralsCollection.actions.refreshed());
  }
}
