import type { AdminSafeBoxListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { unknownTone } from '../../shared/utils';

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
    type: ColumnType.NUMBER,
    value: (row) => row.traderId,
  },
  {
    key: 'terminalId',
    header: 'common.terminal',
    type: ColumnType.NUMBER,
    value: (row) => row.terminalId,
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
    key: 'linkedOrderId',
    header: 'safe_box.linked_order',
    type: ColumnType.MONO,
    value: (row) => row.linkedOrderId,
  },
  {
    key: 'comment',
    header: 'safe_box.comment',
    type: ColumnType.TEXT,
    value: (row) => row.comment,
  },
];
