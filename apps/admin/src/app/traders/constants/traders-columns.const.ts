import type { AdminTraderListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';

/**
 * There is no API-token column and there must never be one.
 *
 * That token authenticates the extension as its trader, so listing it would
 * turn read access to this panel into full impersonation of every trader. The
 * backend drops it in the query projection, so it does not reach here to be
 * shown by accident.
 */
export const TRADER_COLUMNS: readonly ColumnDef<AdminTraderListItem>[] = [
  {
    key: 'traderId',
    header: 'traders.trader_id',
    type: ColumnType.MONO,
    value: (trader) => trader.traderId,
    sortable: true,
    width: '120px',
  },
  {
    key: 'terminalsTotal',
    header: 'traders.terminals',
    type: ColumnType.NUMBER,
    value: (trader) => trader.terminalsTotal,
  },
  {
    key: 'terminalsEnabled',
    header: 'traders.terminals_enabled',
    type: ColumnType.NUMBER,
    value: (trader) => trader.terminalsEnabled,
  },
  {
    key: 'pendingAlerts',
    header: 'traders.pending_alerts',
    type: ColumnType.NUMBER,
    value: (trader) => trader.pendingAlerts,
  },
  {
    key: 'isActive',
    header: 'common.status',
    type: ColumnType.BOOL,
    value: (trader) => trader.isActive,
  },
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (trader) => trader.createdAt,
    sortable: true,
  },
];

export const TraderAction = {
  ACTIVATE: 'activate',
  DEACTIVATE: 'deactivate',
} as const;
export type TraderAction = (typeof TraderAction)[keyof typeof TraderAction];

export const TRADER_ROW_ACTIONS: readonly RowAction<AdminTraderListItem>[] = [
  {
    id: TraderAction.ACTIVATE,
    label: 'traders.activate',
    icon: 'check_circle',
    visible: (trader) => !trader.isActive,
  },
  {
    id: TraderAction.DEACTIVATE,
    label: 'traders.deactivate',
    icon: 'block',
    visible: (trader) => trader.isActive,
    destructive: true,
  },
];
