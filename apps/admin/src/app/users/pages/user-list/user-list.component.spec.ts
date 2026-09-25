import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Store, provideState, provideStore } from '@ngrx/store';
import { provideTranslateService } from '@ngx-translate/core';
import {
  AdminBalanceOperation,
  AdminBalanceTarget,
  type AdminAdjustBalanceReq,
  type AdminTmaUserListItem,
} from '@transacto/contracts';
import { of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BalanceDialogComponent,
  ConfirmDialogComponent,
  ReasonDialogComponent,
} from '../../../shared/components';
import { USERS_FEATURE, userActions, usersCollection } from '../../store/users.collection';
import { USER_ROW_ACTIONS, UserAction } from '../../constants/user-columns.const';
import { UserListComponent } from './user-list.component';

const USER: AdminTmaUserListItem = {
  telegramId: 414131219,
  firstName: 'Oleg',
  lastName: '',
  username: 'oleg',
  balance: 18_500,
  frozenBalance: 0,
  referralBalance: 0,
  totalTurnover: 0,
  trustLevel: 'NEWBIE' as AdminTmaUserListItem['trustLevel'],
  isActive: true,
  isDemo: false,
  referralCode: null,
  referredBy: null,
  openOrders: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const FORM_RESULT: AdminAdjustBalanceReq = {
  operation: AdminBalanceOperation.CREDIT,
  target: AdminBalanceTarget.BALANCE,
  amountCents: 500,
  reason: 'причина з форми',
};

/** What a `MatDialog.open` result has to look like for these flows. */
type OpenResult = { afterClosed: () => Observable<unknown> };

/**
 * The two-dialog balance flow.
 *
 * It shipped asking for the reason **twice** — the confirmation step reused
 * `ReasonDialogComponent`, whose whole purpose is to collect one — and then
 * kept only the second answer, so the explanation the operator wrote alongside
 * the amount never reached the audit row. These assertions pin both halves of
 * the fix: one prompt, and the form's own reason is what is sent.
 */
describe('UserListComponent balance flow', () => {
  const opened: unknown[] = [];
  const dispatch = vi.fn();

  // The generic is explicit: inferred from the default implementation, the
  // return type would narrow to "the form result or `true`" and then refuse the
  // dismissal cases below, which close with `undefined`.
  const dialogStub = {
    open: vi.fn<(component: unknown) => OpenResult>((component) => {
      opened.push(component);

      return {
        afterClosed: () => of(component === BalanceDialogComponent ? FORM_RESULT : true),
      };
    }),
  };

  const build = (): UserListComponent => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        // The real store with the real reducer — there is no mock-store entry
        // point in this NgRx build, and the component only reads one slice and
        // dispatches, so the real one is both available and more honest.
        provideStore(),
        provideState(USERS_FEATURE, usersCollection.reducer),
        { provide: MatDialog, useValue: dialogStub },
      ],
    });

    const store = TestBed.inject(Store);
    // Installed after construction would miss nothing, but installing it here
    // keeps the `entered()` dispatch the constructor makes out of the way of
    // the assertions below.
    vi.spyOn(store, 'dispatch').mockImplementation(dispatch);

    return TestBed.createComponent(UserListComponent).componentInstance;
  };

  /**
   * Only the balance action, ignoring the `entered()` the constructor
   * dispatches. Asserting on `dispatch` as a whole would fail on that alone —
   * and would keep passing if the component started dispatching something else
   * entirely.
   */
  const adjustDispatches = () =>
    dispatch.mock.calls
      .map(([action]) => action as { type: string })
      .filter((action) => action.type === userActions.adjustBalance.type);

  beforeEach(() => {
    opened.length = 0;
    dispatch.mockReset();
    dialogStub.open.mockClear();
  });

  it('asks for the reason exactly once', () => {
    build().onAction({ actionId: UserAction.ADJUST_BALANCE, row: USER });

    // The form collects it; the confirmation only restates the figures.
    expect(opened).toEqual([BalanceDialogComponent, ConfirmDialogComponent]);
    expect(opened).not.toContain(ReasonDialogComponent);
  });

  it('sends the reason the operator typed on the form', () => {
    build().onAction({ actionId: UserAction.ADJUST_BALANCE, row: USER });

    expect(adjustDispatches()).toEqual([
      userActions.adjustBalance({ telegramId: USER.telegramId, body: FORM_RESULT }),
    ]);
  });

  it('sends nothing when the form is dismissed', () => {
    dialogStub.open.mockImplementationOnce((component): OpenResult => {
      opened.push(component);

      return { afterClosed: () => of(undefined) };
    });

    build().onAction({ actionId: UserAction.ADJUST_BALANCE, row: USER });

    expect(opened).toEqual([BalanceDialogComponent]);
    expect(adjustDispatches()).toEqual([]);
  });

  /**
   * Escape and a click outside both close with `undefined`. Treating that as a
   * confirmation would move money on a dismissed dialog.
   */
  it('sends nothing when the confirmation is dismissed', () => {
    dialogStub.open.mockImplementation((component: unknown) => {
      opened.push(component);

      return {
        afterClosed: () => of(component === BalanceDialogComponent ? FORM_RESULT : undefined),
      };
    });

    build().onAction({ actionId: UserAction.ADJUST_BALANCE, row: USER });

    expect(opened).toEqual([BalanceDialogComponent, ConfirmDialogComponent]);
    expect(adjustDispatches()).toEqual([]);
  });

  /** Blocking still collects a reason, because it has no form of its own. */
  it('still uses the reason dialog for blocking', () => {
    build().onAction({ actionId: UserAction.BLOCK, row: USER });

    expect(opened).toEqual([ReasonDialogComponent]);
  });
});

/**
 * A demo account shows its owner invented figures and refuses everything they
 * send, so the menu must never offer it where it would hide real money — and
 * must never switch anything without a reason on the audit row.
 */
describe('UserListComponent demo flow', () => {
  const dispatch = vi.fn();
  const dialogStub = {
    open: vi.fn<(component: unknown) => OpenResult>(() => ({
      afterClosed: () => of('рекламна кампанія'),
    })),
  };

  const build = (): UserListComponent => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        provideStore(),
        provideState(USERS_FEATURE, usersCollection.reducer),
        { provide: MatDialog, useValue: dialogStub },
      ],
    });

    vi.spyOn(TestBed.inject(Store), 'dispatch').mockImplementation(dispatch);

    return TestBed.createComponent(UserListComponent).componentInstance;
  };

  const visible = (id: UserAction, user: AdminTmaUserListItem): boolean =>
    USER_ROW_ACTIONS.find((action) => action.id === id)?.visible?.(user) ?? true;

  const demoDispatches = () =>
    dispatch.mock.calls
      .map(([action]) => action as { type: string })
      .filter((action) => action.type === userActions.setDemo.type);

  const EMPTY: AdminTmaUserListItem = { ...USER, balance: 0 };

  beforeEach(() => {
    dispatch.mockReset();
    dialogStub.open.mockClear();
  });

  it('offers the demo only on an account with nothing on it', () => {
    expect(visible(UserAction.ENABLE_DEMO, EMPTY)).toBe(true);
    expect(visible(UserAction.ENABLE_DEMO, USER)).toBe(false);
    expect(visible(UserAction.ENABLE_DEMO, { ...EMPTY, openOrders: 1 })).toBe(false);
    expect(visible(UserAction.DISABLE_DEMO, EMPTY)).toBe(false);
  });

  it('offers only the way back on a demo account', () => {
    const demo = { ...EMPTY, isDemo: true };

    expect(visible(UserAction.ENABLE_DEMO, demo)).toBe(false);
    expect(visible(UserAction.DISABLE_DEMO, demo)).toBe(true);
  });

  it('asks for a reason and sends it with the switch', () => {
    build().onAction({ actionId: UserAction.ENABLE_DEMO, row: EMPTY });

    expect(dialogStub.open).toHaveBeenCalledWith(ReasonDialogComponent, expect.anything());
    expect(demoDispatches()).toEqual([
      userActions.setDemo({
        telegramId: EMPTY.telegramId,
        body: { isDemo: true, reason: 'рекламна кампанія' },
      }),
    ]);
  });

  it('sends nothing when the dialog is dismissed', () => {
    dialogStub.open.mockImplementationOnce(() => ({ afterClosed: () => of(undefined) }));

    build().onAction({ actionId: UserAction.DISABLE_DEMO, row: { ...EMPTY, isDemo: true } });

    expect(demoDispatches()).toEqual([]);
  });
});
