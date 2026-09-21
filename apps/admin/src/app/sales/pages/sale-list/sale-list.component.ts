import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  AdminSaleAction,
  type AdminSaleListItem,
  type AdminSortDirection,
} from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  FilterChipsComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  RefundDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import { bindListQuery, formatUah, formatUsdt } from '../../../shared/utils';
import {
  SALE_COLUMNS,
  SALE_FILTERS,
  SALE_ROW_ACTIONS,
} from '../../constants/sales-columns.const';
import { saleActions, salesCollection } from '../../store/sales.collection';

/**
 * How each intervention is presented, and which dialog collects it.
 *
 * A lookup rather than a `switch`, so adding a member to
 * `AdminSaleAction` fails to compile here until its copy and its dialog
 * are decided — better than a dialog that opens with an untranslated key on it.
 *
 * `refund: true` marks the two that move money back and so need an amount. The
 * rest only need a reason.
 */
const ACTION_COPY: Readonly<
  Record<
    AdminSaleAction,
    { title: string; message: string; destructive: boolean; refund: boolean }
  >
> = {
  [AdminSaleAction.CANCEL]: {
    title: 'sales.cancel',
    message: 'sales.cancel_confirm',
    destructive: true,
    refund: true,
  },
  [AdminSaleAction.BLOCK]: {
    title: 'sales.block',
    message: 'sales.block_confirm',
    destructive: true,
    refund: false,
  },
  [AdminSaleAction.COMPLETE]: {
    title: 'sales.complete',
    message: 'sales.complete_confirm',
    destructive: false,
    refund: false,
  },
  [AdminSaleAction.RESUME]: {
    title: 'sales.resume',
    message: 'sales.resume_confirm',
    destructive: false,
    refund: false,
  },
  [AdminSaleAction.RELEASE]: {
    title: 'sales.release',
    message: 'sales.release_confirm',
    destructive: true,
    refund: true,
  },
  // Destructive without moving money: it hands back a slot by asserting
  // something about a jar that nobody has verified. The confirmation is the
  // whole safeguard, so it says exactly what is being asserted.
  [AdminSaleAction.RELEASE_JAR]: {
    title: 'sales.release_jar',
    message: 'sales.release_jar_confirm',
    destructive: true,
    refund: false,
  },
};

@Component({
  selector: 'app-sale-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    SearchFieldComponent,
    FilterChipsComponent,
    CollectionTableComponent,
  ],
  templateUrl: './sale-list.component.html',
  styleUrl: './sale-list.component.scss',
})
export class SaleListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly columns = SALE_COLUMNS;
  readonly filters = SALE_FILTERS;
  readonly rowActions = SALE_ROW_ACTIONS;
  readonly state = this.store.selectSignal(salesCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = salesCollection.idOf;

  constructor() {
    // Opens the list and applies whatever a link asked for — see
    // `bindListQuery`. It is what makes "the disputes on this terminal" a link
    // rather than an instruction.
    bindListQuery(salesCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(salesCollection.actions.searchChanged({ search }));
  }

  /** `slice`, not `filter`: the name is taken by rxjs at the top of this file. */
  onFilter(slice: string | null): void {
    this.store.dispatch(salesCollection.actions.filterChanged({ filter: slice }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(salesCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(salesCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(salesCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminSaleListItem>): void {
    const action = actionId as AdminSaleAction;
    const copy = ACTION_COPY[action];
    if (!copy) return;

    const params = {
      publicId: row.publicId,
      user: row.username,
      target: formatUah(row.fiatAmount),
      received: formatUah(row.receivedAmount),
      stake: formatUsdt(row.frozenUsdt),
    };

    if (copy.refund) {
      this.dialog
        .open(RefundDialogComponent, {
          data: {
            title: copy.title,
            message: copy.message,
            messageParams: params,
            confirmLabel: copy.title,
            frozenUsdt: row.frozenUsdt,
            suggestedRefundCents: row.suggestedRefundCents,
            receivedAmount: row.receivedAmount,
          },
        })
        .afterClosed()
        .pipe(filter(Boolean))
        .subscribe((result) =>
          this.store.dispatch(
            saleActions.act({
              id: row.id,
              body: { action, reason: result.reason, refundCents: result.refundCents },
            }),
          ),
        );

      return;
    }

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: copy.title,
          message: copy.message,
          messageParams: params,
          confirmLabel: copy.title,
          destructive: copy.destructive,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(saleActions.act({ id: row.id, body: { action, reason } })),
      );
  }
}
