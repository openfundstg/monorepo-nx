import type { AdminTmaUserListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import { flagTone } from '../../shared/utils';

/**
 * The users list, described.
 *
 * `sortable` is set only on the fields `ADMIN_SORTABLE.USERS` allows on the
 * backend — a header offering a sort the server falls back on is one that looks
 * broken.
 */
export const USER_COLUMNS: readonly ColumnDef<AdminTmaUserListItem>[] = [
  {
    key: 'telegramId',
    header: 'users.telegram_id',
    type: ColumnType.MONO,
    value: (user) => user.telegramId,
    sortable: true,
    width: '120px',
  },
  {
    key: 'username',
    header: 'users.name',
    type: ColumnType.TEXT,
    value: (user) =>
      user.username ? `@${user.username}` : [user.firstName, user.lastName].join(' ').trim(),
  },
  {
    key: 'balance',
    header: 'users.balance',
    type: ColumnType.USDT,
    value: (user) => user.balance,
    sortable: true,
  },
  {
    key: 'frozenBalance',
    header: 'users.frozen',
    type: ColumnType.USDT,
    value: (user) => user.frozenBalance,
    sortable: true,
  },
  {
    key: 'referralBalance',
    header: 'users.referral_balance',
    type: ColumnType.USDT,
    value: (user) => user.referralBalance,
    sortable: true,
  },
  {
    key: 'totalTurnover',
    header: 'users.turnover',
    type: ColumnType.UAH,
    value: (user) => user.totalTurnover,
    sortable: true,
  },
  {
    key: 'trustLevel',
    header: 'users.trust_level',
    type: ColumnType.CHIP,
    value: (user) => user.trustLevel,
    tone: () => flagTone(true),
    translatePrefix: 'TRUST_LEVEL',
  },
  {
    key: 'openOrders',
    header: 'users.open_orders',
    type: ColumnType.NUMBER,
    value: (user) => user.openOrders,
  },
  {
    key: 'isActive',
    header: 'users.active',
    type: ColumnType.BOOL,
    value: (user) => user.isActive,
  },
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (user) => user.createdAt,
    sortable: true,
  },
];

/** Ids the list component switches on. */
export const UserAction = {
  OPEN: 'open',
  BLOCK: 'block',
  UNBLOCK: 'unblock',
  ADJUST_BALANCE: 'adjust-balance',
} as const;
export type UserAction = (typeof UserAction)[keyof typeof UserAction];

/**
 * Block and unblock are two entries rather than one toggle.
 *
 * A menu item whose label depends on the row is one an operator reads wrong
 * when they are moving quickly, and this particular misreading unblocks
 * somebody who was blocked for a reason.
 */
export const USER_ROW_ACTIONS: readonly RowAction<AdminTmaUserListItem>[] = [
  { id: UserAction.OPEN, label: 'users.open', icon: 'open_in_new' },
  {
    id: UserAction.BLOCK,
    label: 'users.block',
    icon: 'block',
    visible: (user) => user.isActive,
    destructive: true,
  },
  {
    id: UserAction.UNBLOCK,
    label: 'users.unblock',
    icon: 'check_circle',
    visible: (user) => !user.isActive,
  },
  {
    id: UserAction.ADJUST_BALANCE,
    label: 'users.adjust_balance',
    icon: 'payments',
    destructive: true,
  },
];
