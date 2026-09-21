import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  AdminFiatDepositAction,
  type AdminDepositRowItem,
  type AdminSortDirection,
} from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  BookFiltersComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import { bindListQuery, formatUah, formatUsdt } from '../../../shared/utils';
import {
  DEPOSIT_COLUMNS,
  DEPOSIT_VARIANTS,
  DEPOSIT_STATUSES,
  DEPOSIT_ROW_ACTIONS,
  depositRowClass,
} from '../../constants/deposits-columns.const';
import { depositActions, depositsCollection } from '../../store/deposits.collection';

/**
 * How each intervention is presented.
 *
 * A lookup rather than a `switch`, so adding a member to
 * `AdminFiatDepositAction` fails to compile here until its copy is decided —
 * better than a dialog that opens with an untranslated key on it.
 */
const ACTION_COPY: Readonly<
  Record<AdminFiatDepositAction, { title: string; message: string; destructive: boolean }>
> = {
  [AdminFiatDepositAction.COMPLETE]: {
    title: 'deposits.complete',
    message: 'deposits.complete_confirm',
    destructive: false,
  },
  [AdminFiatDepositAction.RELEASE]: {
    title: 'deposits.release',
    message: 'deposits.release_confirm',
    destructive: true,
  },
};

/** Both rails of the deposits book, cut by a chip. */
@Component({
  selector: 'app-deposits-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    SearchFieldComponent,
    BookFiltersComponent,
    CollectionTableComponent,
  ],
  templateUrl: './deposits-list.component.html',
  styleUrl: './deposits-list.component.scss',
})
export class DepositsListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly columns = DEPOSIT_COLUMNS;
  readonly variants = DEPOSIT_VARIANTS;
  readonly statuses = DEPOSIT_STATUSES;
  readonly rowActions = DEPOSIT_ROW_ACTIONS;
  readonly state = this.store.selectSignal(depositsCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = depositsCollection.idOf;
  /** Which bank the hryvnia came from — see `depositRowClass`. */
  readonly rowClass = depositRowClass;

  constructor() {
    bindListQuery(depositsCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(depositsCollection.actions.searchChanged({ search }));
  }

  /** The whole form at once — see `BookFiltersComponent.apply`. */
  onFilters(filters: Readonly<Record<string, string>>): void {
    this.store.dispatch(depositsCollection.actions.filtersChanged({ filters }));
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

  onAction({ actionId, row }: RowActionEvent<AdminDepositRowItem>): void {
    const action = actionId as AdminFiatDepositAction;
    const copy = ACTION_COPY[action];
    if (!copy) return;

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: copy.title,
          message: copy.message,
          messageParams: {
            user: row.username,
            amount: formatUah(row.fiatAmount),
            covered: formatUah(row.coveredUah ?? 0),
            crypto: formatUsdt(row.cryptoCents),
            payoutId: row.payoutId,
          },
          confirmLabel: copy.title,
          destructive: copy.destructive,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(depositActions.act({ id: row.id, body: { action, reason } })),
      );
  }
}
