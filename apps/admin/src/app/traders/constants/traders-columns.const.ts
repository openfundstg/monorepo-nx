import type { AdminTraderListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import { alertsLink, ordersLink, terminalLink } from '../../shared/utils';

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
    type: ColumnType.ROUTER_LINK,
    value: (trader) => trader.terminalsTotal,
    link: (trader) => (trader.terminalsTotal === 0 ? null : terminalLink(trader.traderId)),
  },
  {
    key: 'terminalsEnabled',
    header: 'traders.terminals_enabled',
    type: ColumnType.NUMBER,
    value: (trader) => trader.terminalsEnabled,
  },
  {
    // The count and the way to read them. A trader with pending alerts is the
    // one row on this screen that needs somebody, so it is the one that must
    // not end in a number an operator has to go and look up.
    key: 'pendingAlerts',
    header: 'traders.pending_alerts',
    type: ColumnType.ROUTER_LINK,
    value: (trader) => trader.pendingAlerts,
    link: (trader) => (trader.pendingAlerts === 0 ? null : alertsLink(trader.traderId)),
  },
  {
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (trader) => [terminalLink(trader.traderId), ordersLink(trader.traderId)],
    width: '160px',
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
