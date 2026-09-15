import { AlertStatus } from '@transacto/contracts';
import type { AdminAlertListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import { alertTone } from '../../shared/utils';

/**
 * Alerts across every trader.
 *
 * The `type` column renders `'ALERTS.' + type` rather than any stored sentence:
 * the database holds a key and a metadata object, and the client renders the
 * copy. That is the same rule the extension follows, which is why both can show
 * the same alert in different languages from one row.
 */
export const ALERT_COLUMNS: readonly ColumnDef<AdminAlertListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (alert) => alert.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'traderId',
    header: 'common.trader',
    type: ColumnType.NUMBER,
    value: (alert) => alert.traderId,
  },
  {
    key: 'terminalId',
    header: 'common.terminal',
    type: ColumnType.NUMBER,
    value: (alert) => alert.terminalId,
  },
  {
    key: 'type',
    header: 'alerts.type',
    type: ColumnType.CHIP,
    value: (alert) => alert.type,
    tone: (alert) => alertTone(alert.status),
    translatePrefix: 'ALERTS',
  },
  {
    key: 'amount',
    header: 'alerts.amount',
    type: ColumnType.UAH,
    value: (alert) => alert.amount,
    sortable: true,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (alert) => alert.status,
    tone: (alert) => alertTone(alert.status),
    translatePrefix: 'ALERT_STATUS',
    sortable: true,
  },
  {
    key: 'isRead',
    header: 'alerts.read',
    type: ColumnType.BOOL,
    value: (alert) => alert.isRead,
  },
];

export const AlertAction = {
  RESOLVE: 'resolve',
  DELETE: 'delete',
} as const;
export type AlertAction = (typeof AlertAction)[keyof typeof AlertAction];

/**
 * Two actions, and neither is the trader's own.
 *
 * Acknowledging and force-matching stay in the extension — those settle money
 * and belong to whoever owns it. Resolving says an alert was dealt with outside
 * the system; deleting removes one that should never have been raised, and is
 * permanent, so it is offered on every alert rather than only unresolved ones.
 */
export const ALERT_ROW_ACTIONS: readonly RowAction<AdminAlertListItem>[] = [
  {
    id: AlertAction.RESOLVE,
    label: 'alerts.resolve',
    icon: 'check_circle',
    visible: (alert) => alert.status === AlertStatus.PENDING,
  },
  {
    id: AlertAction.DELETE,
    label: 'alerts.delete',
    icon: 'delete_forever',
    destructive: true,
  },
];
