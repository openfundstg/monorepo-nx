import {
  AdminFiatDepositAction,
  isFiatDepositHeld,
  type AdminFiatDepositListItem,
} from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import { fiatDepositTone } from '../../shared/utils';

/**
 * Note `UAH` on the money columns and `USDT` on the credit.
 *
 * A fiat top-up carries both, and they are both `number`: hryvnia kopecks for
 * what the user transfers, USDT cents for what they are owed. Rendering one as
 * the other is the hundredfold error the column type exists to prevent.
 */
export const FIAT_DEPOSIT_COLUMNS: readonly ColumnDef<AdminFiatDepositListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'username',
    header: 'fiat_deposits.user',
    type: ColumnType.TEXT,
    value: (row) => row.username,
  },
  {
    key: 'payoutId',
    header: 'fiat_deposits.payout',
    type: ColumnType.MONO,
    value: (row) => row.payoutId,
  },
  {
    key: 'recipientCard',
    header: 'fiat_deposits.card',
    type: ColumnType.MONO,
    value: (row) => row.recipientCard,
  },
  {
    key: 'amountUah',
    header: 'fiat_deposits.amount',
    type: ColumnType.UAH,
    value: (row) => row.amountUah,
    sortable: true,
  },
  {
    key: 'coveredUah',
    header: 'fiat_deposits.covered',
    type: ColumnType.UAH,
    value: (row) => row.coveredUah,
    sortable: true,
  },
  {
    key: 'cryptoCents',
    header: 'fiat_deposits.credit',
    type: ColumnType.USDT,
    value: (row) => row.cryptoCents,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (row) => row.status,
    tone: (row) => fiatDepositTone(row.status),
    translatePrefix: 'FIAT_DEPOSIT_STATUS',
    sortable: true,
  },
  {
    key: 'acceptedReceiptCount',
    header: 'fiat_deposits.receipts',
    type: ColumnType.NUMBER,
    value: (row) => row.acceptedReceiptCount,
  },
  {
    key: 'holdUntilAt',
    header: 'fiat_deposits.hold_until',
    type: ColumnType.DATE,
    value: (row) => row.holdUntilAt,
    sortable: true,
  },
];

/**
 * Both interventions apply to exactly the rows whose payout is still ours —
 * which is the shared rule, not a menu-specific one.
 *
 * A closed top-up has nothing left to settle, and `REVIEW` is in the set
 * precisely because the automatic path stopped there on purpose. Reusing
 * `isFiatDepositHeld` is also what makes the menu and the backend's own
 * precondition impossible to drift apart.
 */
const isActionable = (row: AdminFiatDepositListItem): boolean => isFiatDepositHeld(row.status);

export const FIAT_DEPOSIT_ROW_ACTIONS: readonly RowAction<AdminFiatDepositListItem>[] = [
  {
    id: AdminFiatDepositAction.COMPLETE,
    label: 'fiat_deposits.complete',
    icon: 'task_alt',
    visible: isActionable,
  },
  {
    id: AdminFiatDepositAction.RELEASE,
    label: 'fiat_deposits.release',
    icon: 'undo',
    visible: isActionable,
    destructive: true,
  },
];
