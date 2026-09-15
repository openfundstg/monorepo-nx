import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import type { AdminSortDirection, AdminTraderListItem } from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import {
  TRADER_COLUMNS,
  TRADER_ROW_ACTIONS,
  TraderAction,
} from '../../constants/traders-columns.const';
import { traderActions, tradersCollection } from '../../store/traders.collection';

@Component({
  selector: 'app-trader-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './trader-list.component.html',
  styleUrl: './trader-list.component.scss',
})
export class TraderListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly columns = TRADER_COLUMNS;
  readonly rowActions = TRADER_ROW_ACTIONS;
  readonly state = this.store.selectSignal(tradersCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(tradersCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(tradersCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(tradersCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(tradersCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(tradersCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminTraderListItem>): void {
    const isActive = actionId === TraderAction.ACTIVATE;

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: isActive ? 'traders.activate' : 'traders.deactivate',
          // Deactivating disconnects that trader's extension immediately — the
          // DB service emits `TRADER_DEACTIVATED` — so the confirmation says so
          // rather than letting an operator find out from a support ticket.
          message: isActive ? 'traders.activate_confirm' : 'traders.deactivate_confirm',
          messageParams: { traderId: row.traderId, terminals: row.terminalsEnabled },
          confirmLabel: isActive ? 'traders.activate' : 'traders.deactivate',
          destructive: !isActive,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(
          traderActions.setActive({ traderId: row.traderId, body: { isActive, reason } }),
        ),
      );
  }
}
