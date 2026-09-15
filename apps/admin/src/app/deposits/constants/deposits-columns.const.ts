import type { AdminDepositListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { depositTone } from '../../shared/utils';

/**
 * Note `USDT_WHOLE` on `cryptoAmount` and `USDT` nowhere.
 *
 * A deposit stores the figure the user typed on the form — whole USDT — while
 * every balance in the system is cents. Rendering one as the other is a
 * hundredfold error, and the column type is where that decision is recorded.
 */
export const DEPOSIT_COLUMNS: readonly ColumnDef<AdminDepositListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (deposit) => deposit.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'username',
    header: 'deposits.user',
    type: ColumnType.TEXT,
    value: (deposit) => deposit.username,
  },
  {
    key: 'cryptoAmount',
    header: 'deposits.amount',
    type: ColumnType.USDT_WHOLE,
    value: (deposit) => deposit.cryptoAmount,
    sortable: true,
  },
  {
    key: 'fiatEquivalent',
    header: 'deposits.fiat',
    type: ColumnType.UAH,
    value: (deposit) => deposit.fiatEquivalent,
  },
  {
    key: 'exchangeRate',
    header: 'common.rate',
    type: ColumnType.UAH,
    value: (deposit) => deposit.exchangeRate,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (deposit) => deposit.status,
    tone: (deposit) => depositTone(deposit.status),
    translatePrefix: 'DEPOSIT_STATUS',
    sortable: true,
  },
  {
    key: 'txId',
    header: 'deposits.tx',
    type: ColumnType.MONO,
    value: (deposit) => deposit.txId,
  },
  {
    key: 'verifiedAt',
    header: 'deposits.verified',
    type: ColumnType.DATE,
    value: (deposit) => deposit.verifiedAt,
    sortable: true,
  },
];
