import type { AdminSafeBoxListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { alertsLink, ordersLink, terminalLink, traderLink, unknownTone } from '../../shared/utils';

/**
 * Money a trader has set aside pending a decision.
 *
 * `status` is `SafeBoxStatus`, which is backend-only — its members are
 * operational states rather than good or bad outcomes, so every one of them
 * draws neutral. Giving `WRITTEN_OFF` a colour would be this screen inventing
 * an opinion the product does not hold.
 */
export const SAFE_BOX_COLUMNS: readonly ColumnDef<AdminSafeBoxListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'traderId',
    header: 'common.trader',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.traderId,
    link: (row) => traderLink(row.traderId),
  },
  {
    key: 'terminalId',
    header: 'common.terminal',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.terminalId,
    link: (row) => terminalLink(row.terminalId),
  },
  {
    key: 'amount',
    header: 'safe_box.amount',
    type: ColumnType.UAH,
    value: (row) => row.amount,
    sortable: true,
  },
  {
    key: 'originalDelta',
    header: 'safe_box.original_delta',
    type: ColumnType.UAH,
    value: (row) => row.originalDelta,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (row) => row.status,
    tone: () => unknownTone(),
    translatePrefix: 'SAFE_BOX_STATUS',
    sortable: true,
  },
  {
    // The order this money was eventually attributed to, where one was found.
    // That attribution is the whole question a safe-box row asks, so it is the
    // one field here that must lead somewhere.
    key: 'linkedOrderId',
    header: 'safe_box.linked_order',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.linkedOrderId,
    link: (row) => (row.linkedOrderId === null ? null : ordersLink(row.linkedOrderId)),
  },
  {
    key: 'comment',
    header: 'safe_box.comment',
    type: ColumnType.TEXT,
    value: (row) => row.comment,
  },
  {
    // The alert that raised it. A safe-box row and an `UNRECOGNIZED_DEPOSIT`
    // are the same event seen twice, and following one to the other used to be
    // three navigations and a remembered terminal id.
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (row) => [alertsLink(row.terminalId), terminalLink(row.terminalId)],
    width: '150px',
  },
];
