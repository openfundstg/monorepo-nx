import type { AdminOrderListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { orderTone, terminalHistoryLink, traderLink } from '../../shared/utils';

/**
 * Transacto orders — one row per payment routed to a terminal.
 *
 * `awaitingUpstreamConfirmation` gets a column of its own because it is the
 * only state here that needs a person: the money arrived and the order settled
 * locally, but Transacto still shows it open, and nothing closes that except a
 * retry or a human.
 */
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
    type: ColumnType.ROUTER_LINK,
    value: (order) => order.traderId,
    link: (order) => traderLink(order.traderId),
  },
  {
    // The card, and the scraping history that says what the jar was doing when
    // this order was routed at it — which is the next question about every
    // order that did not settle.
    key: 'cardId',
    header: 'common.card_id',
    type: ColumnType.ROUTER_LINK,
    value: (order) => order.cardId,
    link: (order) => terminalHistoryLink(order.cardId),
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
    tone: (order) => orderTone(order.status),
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
