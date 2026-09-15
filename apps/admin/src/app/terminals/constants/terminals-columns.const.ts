import type { AdminTerminalListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';

/**
 * `enabled` and `acceptingOrders` are two columns, not one.
 *
 * They answer different questions and the case that separates them matters: a
 * terminal winding down is still scraped, still matches payments and still
 * holds money in flight — it just gets nobody new. Collapsing them into one
 * "active" column would hide live money.
 */
export const TERMINAL_COLUMNS: readonly ColumnDef<AdminTerminalListItem>[] = [
  {
    key: 'terminalName',
    header: 'terminals.name',
    type: ColumnType.TEXT,
    value: (terminal) => terminal.terminalName,
    sortable: true,
  },
  {
    key: 'traderId',
    header: 'common.trader',
    type: ColumnType.NUMBER,
    value: (terminal) => terminal.traderId,
  },
  {
    key: 'cardId',
    header: 'common.card_id',
    type: ColumnType.NUMBER,
    value: (terminal) => terminal.cardId,
  },
  {
    key: 'bankProvider',
    header: 'terminals.bank',
    type: ColumnType.TEXT,
    value: (terminal) => terminal.bankProvider,
  },
  {
    key: 'source',
    header: 'terminals.source',
    type: ColumnType.TEXT,
    value: (terminal) => terminal.source,
  },
  {
    key: 'lastBalance',
    header: 'terminals.balance',
    type: ColumnType.UAH,
    value: (terminal) => terminal.lastBalance,
    sortable: true,
  },
  {
    key: 'lastGoal',
    header: 'terminals.goal',
    type: ColumnType.UAH,
    value: (terminal) => terminal.lastGoal,
  },
  {
    key: 'lastBalanceAt',
    header: 'terminals.balance_at',
    type: ColumnType.DATE,
    value: (terminal) => terminal.lastBalanceAt,
    sortable: true,
  },
  {
    key: 'enabled',
    header: 'terminals.enabled',
    type: ColumnType.BOOL,
    value: (terminal) => terminal.enabled,
  },
  {
    key: 'acceptingOrders',
    header: 'terminals.accepting',
    type: ColumnType.BOOL,
    value: (terminal) => terminal.acceptingOrders,
  },
  {
    key: 'url',
    header: 'terminals.url',
    type: ColumnType.LINK,
    value: (terminal) => terminal.url,
  },
];

export const TerminalAction = {
  HISTORY: 'history',
  ENABLE: 'enable',
  DISABLE: 'disable',
  RESUME_ORDERS: 'resume-orders',
  PAUSE_ORDERS: 'pause-orders',
} as const;
export type TerminalAction = (typeof TerminalAction)[keyof typeof TerminalAction];

/**
 * Four entries rather than two toggles, for the reason the users list uses two:
 * a label that changes with the row is one an operator misreads when moving
 * quickly, and here that misreading puts a jar back into service.
 */
export const TERMINAL_ROW_ACTIONS: readonly RowAction<AdminTerminalListItem>[] = [
  // First, and available on every terminal including a disabled one: the
  // history is how an operator finds out *why* it was disabled.
  { id: TerminalAction.HISTORY, label: 'terminals.history', icon: 'history' },
  {
    id: TerminalAction.ENABLE,
    label: 'terminals.enable',
    icon: 'play_circle',
    visible: (terminal) => !terminal.enabled,
  },
  {
    id: TerminalAction.DISABLE,
    label: 'terminals.disable',
    icon: 'stop_circle',
    visible: (terminal) => terminal.enabled,
    destructive: true,
  },
  {
    id: TerminalAction.RESUME_ORDERS,
    label: 'terminals.resume_orders',
    icon: 'resume',
    visible: (terminal) => terminal.enabled && !terminal.acceptingOrders,
  },
  {
    id: TerminalAction.PAUSE_ORDERS,
    label: 'terminals.pause_orders',
    icon: 'pause_circle',
    visible: (terminal) => terminal.enabled && terminal.acceptingOrders,
    destructive: true,
  },
];
