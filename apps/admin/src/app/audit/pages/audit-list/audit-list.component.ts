import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { bindListQuery } from '../../../shared/utils';
import { AUDIT_COLUMNS } from '../../constants/audit-columns.const';
import { auditCollection } from '../../store/audit.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-audit-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './audit-list.component.html',
  styleUrl: './audit-list.component.scss',
})
export class AuditListComponent {
  private readonly store = inject(Store);

  readonly columns = AUDIT_COLUMNS;
  readonly state = this.store.selectSignal(auditCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = auditCollection.idOf;

  constructor() {
    bindListQuery(auditCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(auditCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(auditCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(auditCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(auditCollection.actions.refreshed());
  }
}
