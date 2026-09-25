import { isDemoEligible, type AdminTmaUserListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import {
  flagTone,
  userAuditLink,
  userDepositsLink,
  userDocumentsLink,
  userLink,
  userReferralsLink,
  userSalesLink,
  userSupportLink,
} from '../../shared/utils';

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
    type: ColumnType.ROUTER_LINK,
    value: (user) => user.telegramId,
    link: (user) => userLink(user.telegramId),
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
    type: ColumnType.ROUTER_LINK,
    value: (user) => user.openOrders,
    // Only a link when there is something to look at: a zero that navigates to
    // an empty list is a link that wasted somebody's click.
    link: (user) => (user.openOrders === 0 ? null : userSalesLink(user.telegramId)),
  },
  {
    /**
     * Everything this person is connected to.
     *
     * The users list is where most investigations start, and every one of them
     * used to continue by copying a Telegram id into another screen's search
     * box. Six links is more than any other row carries, and that is right: a
     * person is what all of it hangs off.
     */
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (user) => [
      userSalesLink(user.telegramId),
      userDepositsLink(user.telegramId),
      userDocumentsLink(user.telegramId),
      userReferralsLink(user.telegramId),
      userSupportLink(user.telegramId),
      userAuditLink(user.telegramId),
    ],
    width: '240px',
  },
  {
    key: 'isActive',
    header: 'users.active',
    type: ColumnType.BOOL,
    value: (user) => user.isActive,
  },
  {
    /**
     * On the row because a demo account looks, from here, like an ordinary one
     * with nothing on it — and support has to know why somebody showing a
     * healthy balance on their phone cannot sell a cent of it.
     */
    key: 'isDemo',
    header: 'users.demo',
    type: ColumnType.BOOL,
    value: (user) => user.isDemo,
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
  ENABLE_DEMO: 'enable-demo',
  DISABLE_DEMO: 'disable-demo',
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
  /**
   * Two entries rather than a toggle, for the reason block and unblock are.
   *
   * Offered only where the server would accept it — `isDemoEligible`, from
   * contracts, is the rule it checks, so the menu cannot offer what it would
   * refuse. The one thing a row cannot show, a hryvnia top-up in flight, the
   * server still refuses on its own.
   */
  {
    id: UserAction.ENABLE_DEMO,
    label: 'users.enable_demo',
    icon: 'theaters',
    visible: (user) => !user.isDemo && isDemoEligible(user),
  },
  {
    id: UserAction.DISABLE_DEMO,
    label: 'users.disable_demo',
    icon: 'theaters',
    visible: (user) => user.isDemo,
  },
  {
    id: UserAction.ADJUST_BALANCE,
    label: 'users.adjust_balance',
    icon: 'payments',
    destructive: true,
  },
];
