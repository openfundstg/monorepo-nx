import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import type {
  AdminSetTerminalStateReq,
  AdminSortDirection,
  AdminTerminalListItem,
} from '@transacto/contracts';
import { filter } from 'rxjs';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import {
  TERMINAL_COLUMNS,
  TERMINAL_ROW_ACTIONS,
  TerminalAction,
} from '../../constants/terminals-columns.const';
import { terminalActions, terminalsCollection } from '../../store/terminals.collection';

/**
 * Each action's copy and the single flag it moves.
 *
 * The request body carries only the flag being changed — both fields are
 * optional on purpose, so pausing routing does not restate `enabled` and
 * accidentally re-enable a terminal somebody disabled a moment earlier.
 *
 * `Partial`, because `HISTORY` belongs to no entry here: it navigates rather
 * than writing anything, and is handled before this lookup is reached.
 */
const ACTION_SPEC: Readonly<
  Partial<
    Record<
      TerminalAction,
      {
        title: string;
        message: string;
        destructive: boolean;
        patch: Omit<AdminSetTerminalStateReq, 'reason'>;
      }
    >
  >
> = {
  [TerminalAction.ENABLE]: {
    title: 'terminals.enable',
    message: 'terminals.enable_confirm',
    destructive: false,
    patch: { enabled: true },
  },
  [TerminalAction.DISABLE]: {
    title: 'terminals.disable',
    message: 'terminals.disable_confirm',
    destructive: true,
    patch: { enabled: false },
  },
  [TerminalAction.RESUME_ORDERS]: {
    title: 'terminals.resume_orders',
    message: 'terminals.resume_orders_confirm',
    destructive: false,
    patch: { acceptingOrders: true },
  },
  [TerminalAction.PAUSE_ORDERS]: {
    title: 'terminals.pause_orders',
    message: 'terminals.pause_orders_confirm',
    destructive: true,
    patch: { acceptingOrders: false },
  },
};

@Component({
  selector: 'app-terminal-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './terminal-list.component.html',
  styleUrl: './terminal-list.component.scss',
})
export class TerminalListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly columns = TERMINAL_COLUMNS;
  readonly rowActions = TERMINAL_ROW_ACTIONS;
  readonly state = this.store.selectSignal(terminalsCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = terminalsCollection.idOf;

  constructor() {
    this.store.dispatch(terminalsCollection.actions.entered());
  }

  onSearch(search: string): void {
    this.store.dispatch(terminalsCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(terminalsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(terminalsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(terminalsCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminTerminalListItem>): void {
    if (actionId === TerminalAction.HISTORY) {
      void this.router.navigate(['/terminals', row.cardId, 'history']);
      return;
    }

    const spec = ACTION_SPEC[actionId as TerminalAction];
    if (!spec) return;

    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: spec.title,
          message: spec.message,
          messageParams: { name: row.terminalName, cardId: row.cardId },
          confirmLabel: spec.title,
          destructive: spec.destructive,
        },
      })
      .afterClosed()
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(
          terminalActions.setState({ cardId: row.cardId, body: { ...spec.patch, reason } }),
        ),
      );
  }
}
