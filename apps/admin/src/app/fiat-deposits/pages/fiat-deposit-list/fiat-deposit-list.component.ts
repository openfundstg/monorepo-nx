import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  AdminFiatDepositAction,
  type AdminFiatDepositListItem,
  type AdminSortDirection,
} from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import { formatUah, formatUsdt } from '../../../shared/utils';
import {
  FIAT_DEPOSIT_COLUMNS,
  FIAT_DEPOSIT_ROW_ACTIONS,
} from '../../constants/fiat-deposits-columns.const';
import { fiatDepositActions, fiatDepositsCollection } from '../../store/fiat-deposits.collection';

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
    title: 'fiat_deposits.complete',
    message: 'fiat_deposits.complete_confirm',
    destructive: false,
  },
  [AdminFiatDepositAction.RELEASE]: {
    title: 'fiat_deposits.release',
    message: 'fiat_deposits.release_confirm',
    destructive: true,
  },
};

@Component({
  selector: 'app-fiat-deposit-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './fiat-deposit-list.component.html',
  styleUrl: './fiat-deposit-list.component.scss',
})
export class FiatDepositListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly columns = FIAT_DEPOSIT_COLUMNS;
  readonly rowActions = FIAT_DEPOSIT_ROW_ACTIONS;
  readonly state = this.store.selectSignal(fiatDepositsCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(fiatDepositsCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(fiatDepositsCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(fiatDepositsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(fiatDepositsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(fiatDepositsCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminFiatDepositListItem>): void {
    const action = actionId as AdminFiatDepositAction;
    const copy = ACTION_COPY[action];
    if (!copy) return;

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: copy.title,
          message: copy.message,
          // Both figures, always. The question one of these decisions starts
          // from is "how much of it had actually landed?", and the answer is
          // the difference between these two numbers.
          messageParams: {
            user: row.username,
            payoutId: row.payoutId,
            amount: formatUah(row.amountUah),
            covered: formatUah(row.coveredUah),
            credit: formatUsdt(row.cryptoCents),
          },
          confirmLabel: copy.title,
          destructive: copy.destructive,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(fiatDepositActions.act({ id: row.id, body: { action, reason } })),
      );
  }
}
