import type { AdminOrderListItem } from '@transacto/contracts';
import { OrderStatus } from '@transacto/contracts';
import { ChipTone, ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';

/**
 * Transacto orders — one row per payment routed to a terminal.
 *
 * `awaitingUpstreamConfirmation` gets a column of its own because it is the
 * only state here that needs a person: the money arrived and the order settled
 * locally, but Transacto still shows it open, and nothing closes that except a
 * retry or a human.
 */
const ORDER_TONES: Readonly<Record<OrderStatus, ChipTone>> = {
  [OrderStatus.PENDING]: ChipTone.WARNING,
  [OrderStatus.EXECUTED]: ChipTone.POSITIVE,
  [OrderStatus.CANCELLED]: ChipTone.NEUTRAL,
  // Held by Transacto rather than by us, and both need somebody to look: a
  // paused order routes nobody, and an appeal is money in dispute.
  [OrderStatus.PAUSED]: ChipTone.WARNING,
  [OrderStatus.APPEAL]: ChipTone.DANGER,
};

export const ORDER_COLUMNS: readonly ColumnDef<AdminOrderListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (order) => order.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'orderId',
    header: 'orders.order_id',
    type: ColumnType.MONO,
    value: (order) => order.orderId,
  },
  {
    key: 'traderId',
    header: 'common.trader',
    type: ColumnType.NUMBER,
    value: (order) => order.traderId,
  },
  {
    key: 'cardId',
    header: 'common.card_id',
    type: ColumnType.NUMBER,
    value: (order) => order.cardId,
  },
  {
    key: 'amount',
    header: 'orders.amount',
    type: ColumnType.UAH,
    value: (order) => order.amount,
    sortable: true,
  },
  {
    key: 'actualAmount',
    header: 'orders.actual',
    type: ColumnType.UAH,
    value: (order) => order.actualAmount,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (order) => order.status,
    tone: (order) => ORDER_TONES[order.status],
    translatePrefix: 'ORDER_STATUS',
    sortable: true,
  },
  {
    key: 'awaitingUpstreamConfirmation',
    header: 'orders.awaiting_upstream',
    type: ColumnType.BOOL,
    value: (order) => order.awaitingUpstreamConfirmation,
  },
  {
    key: 'lastSyncAt',
    header: 'orders.last_sync',
    type: ColumnType.DATE,
    value: (order) => order.lastSyncAt,
    sortable: true,
  },
];
