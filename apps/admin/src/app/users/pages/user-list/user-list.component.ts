import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AdminBalanceTarget } from '@transacto/contracts';
import type { AdminSortDirection, AdminTmaUserListItem } from '@transacto/contracts';
import { filter, map, switchMap } from 'rxjs';
import {
  BalanceDialogComponent,
  CollectionTableComponent,
  ConfirmDialogComponent,
  PageHeaderComponent,
  ReasonDialogComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import { bindListQuery, formatUsdt } from '../../../shared/utils';
import { USER_COLUMNS, USER_ROW_ACTIONS, UserAction } from '../../constants/user-columns.const';
import { userActions, usersCollection } from '../../store/users.collection';

/**
 * The users list.
 *
 * It renders and delegates: the table is generic, the query lives in the store,
 * and every action is a dispatch. The only logic here is turning a menu click
 * into the right dialog — which is a presentation decision, and the one place a
 * "are you sure" belongs.
 */
@Component({
  selector: 'app-user-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, SearchFieldComponent, CollectionTableComponent],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
})
export class UserListComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly columns = USER_COLUMNS;
  readonly rowActions = USER_ROW_ACTIONS;
  readonly state = this.store.selectSignal(usersCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = usersCollection.idOf;

  constructor() {
    bindListQuery(usersCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(usersCollection.actions.searchChanged({ search }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(usersCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(usersCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(usersCollection.actions.refreshed());
  }

  onAction({ actionId, row }: RowActionEvent<AdminTmaUserListItem>): void {
    switch (actionId) {
      case UserAction.OPEN:
        void this.router.navigate(['/users', row.telegramId]);
        return;
      case UserAction.BLOCK:
        return this.confirmActive(row, false);
      case UserAction.UNBLOCK:
        return this.confirmActive(row, true);
      case UserAction.ADJUST_BALANCE:
        return this.openBalanceDialog(row);
    }
  }

  private confirmActive(user: AdminTmaUserListItem, isActive: boolean): void {
    this.dialog
      .open(ReasonDialogComponent, {
        data: {
          title: isActive ? 'users.unblock' : 'users.block',
          message: isActive ? 'users.unblock_confirm' : 'users.block_confirm',
          messageParams: { name: this.name(user) },
          confirmLabel: isActive ? 'users.unblock' : 'users.block',
          destructive: !isActive,
        },
      })
      .afterClosed()
      // A dialog dismissed with Escape or a click outside closes with
      // `undefined`, which must not read as an empty reason.
      .pipe(filter((reason): reason is string => Boolean(reason)))
      .subscribe((reason) =>
        this.store.dispatch(
          userActions.setActive({ telegramId: user.telegramId, body: { isActive, reason } }),
        ),
      );
  }

  /**
   * The form, then a confirmation of it.
   *
   * The second step **restates and never re-asks**. It used to reuse
   * `ReasonDialogComponent`, which meant the operator was asked for a reason
   * twice and only the second answer survived — the explanation they wrote
   * while filling in the amount was silently discarded on the way to the audit
   * row. A confirmation has nothing to collect; everything it shows was already
   * entered.
   *
   * The step is kept because this is the one action with no product equivalent
   * and no undo. The form itself now previews the resulting balance, so the
   * confirmation restates a figure the operator has already seen and agreed
   * with, rather than being the first place they see it.
   */
  private openBalanceDialog(user: AdminTmaUserListItem): void {
    this.dialog
      .open(BalanceDialogComponent, {
        data: {
          username: this.name(user),
          balance: user.balance,
          referralBalance: user.referralBalance,
        },
      })
      .afterClosed()
      .pipe(
        filter(Boolean),
        switchMap((body) =>
          this.dialog
            .open(ConfirmDialogComponent, {
              data: {
                title: 'users.adjust_balance',
                message: 'users.adjust_balance_confirm',
                messageParams: {
                  name: this.name(user),
                  // Translated, so the sentence reads as a sentence rather than
                  // naming an enum member back at the operator.
                  operation: this.translate.instant(
                    `users.operation_${body.operation.toLowerCase()}`,
                  ),
                  target: this.translate.instant(
                    body.target === AdminBalanceTarget.REFERRAL_BALANCE
                      ? 'users.referral_balance'
                      : 'users.balance',
                  ),
                  amount: formatUsdt(body.amountCents),
                },
                confirmLabel: 'users.apply_adjustment',
                destructive: true,
              },
            })
            .afterClosed()
            // Escape and a click outside both close with `undefined`, which must
            // not read as a confirmation.
            .pipe(
              filter(Boolean),
              map(() => body),
            ),
        ),
      )
      .subscribe((body) =>
        this.store.dispatch(userActions.adjustBalance({ telegramId: user.telegramId, body })),
      );
  }

  private name(user: AdminTmaUserListItem): string {
    return user.username ? `@${user.username}` : String(user.telegramId);
  }
}
