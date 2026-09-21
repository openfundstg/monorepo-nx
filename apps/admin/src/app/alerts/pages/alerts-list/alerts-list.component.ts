import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import type { AdminAlertListItem, AdminSortDirection } from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import { bindListQuery, formatUah } from '../../../shared/utils';
import {
  ALERT_COLUMNS,
  ALERT_ROW_ACTIONS,
  AlertAction,
} from '../../constants/alerts-columns.const';
import { alertActions, alertsCollection } from '../../store/alerts.collection';

/** Renders and delegates — the query lives in the store, the table is generic. */
@Component({
  selector: 'app-alerts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './alerts-list.component.html',
  styleUrl: './alerts-list.component.scss',
})
export class AlertsListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly columns = ALERT_COLUMNS;
  readonly rowActions = ALERT_ROW_ACTIONS;
  readonly state = this.store.selectSignal(alertsCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = alertsCollection.idOf;

  constructor() {
    bindListQuery(alertsCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(alertsCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(alertsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(alertsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(alertsCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminAlertListItem>): void {
    const deleting = actionId === AlertAction.DELETE;

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: deleting ? 'alerts.delete' : 'alerts.resolve',
          // Deleting says so plainly: the row goes for good, and only the audit
          // entry keeps what it said.
          message: deleting ? 'alerts.delete_confirm' : 'alerts.resolve_confirm',
          messageParams: {
            type: row.type,
            trader: row.traderId,
            terminal: row.terminalId,
            amount: formatUah(row.amount),
          },
          confirmLabel: deleting ? 'alerts.delete' : 'alerts.resolve',
          destructive: deleting,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(
          deleting
            ? alertActions.delete({ id: row.id, body: { reason } })
            : alertActions.resolve({ id: row.id, body: { reason } }),
        ),
      );
  }
}
