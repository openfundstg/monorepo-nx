import type { AdminFiatDepositWatchListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { fiatWatchModeTone } from '../../shared/utils';

/**
 * A request is two hryvnia figures and a person — nothing else about them.
 *
 * Both bounds are `UAH` kopecks and the column type is what keeps them from
 * rendering as anything else. There are no row actions: nothing an operator
 * could do here would help the person waiting, and the thing that would —
 * creating a payout in that range — happens in Transacto's own panel.
 */
export const FIAT_DEPOSIT_WATCH_COLUMNS: readonly ColumnDef<AdminFiatDepositWatchListItem>[] = [
  {
    key: 'createdAt',
    header: 'fiat_deposit_watches.asked',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'username',
    header: 'fiat_deposit_watches.user',
    type: ColumnType.TEXT,
    value: (row) => row.username,
  },
  {
    key: 'telegramId',
    header: 'fiat_deposit_watches.telegram_id',
    type: ColumnType.MONO,
    value: (row) => row.telegramId,
  },
  {
    key: 'minAmountUah',
    header: 'fiat_deposit_watches.from',
    type: ColumnType.UAH,
    value: (row) => row.minAmountUah,
    sortable: true,
  },
  {
    key: 'maxAmountUah',
    header: 'fiat_deposit_watches.to',
    type: ColumnType.UAH,
    value: (row) => row.maxAmountUah,
    sortable: true,
  },
  {
    key: 'mode',
    header: 'fiat_deposit_watches.mode',
    type: ColumnType.CHIP,
    value: (row) => row.mode,
    translatePrefix: 'FIAT_DEPOSIT_WATCH_MODE',
    // No cast: `row.mode` is already the contract enum, and a cast here would
    // absorb a member added to it — which is the one thing the tone map's
    // fallback-free `Record` exists to make fail at compile time.
    tone: (row) => fiatWatchModeTone(row.mode),
  },
  {
    /**
     * Sortable, and it is the sort this screen is really for: ascending puts
     * the requests that have never once fired at the top, which is the list of
     * sums nobody has been able to offer anybody.
     */
    key: 'lastNotifiedAt',
    header: 'fiat_deposit_watches.last_notified',
    type: ColumnType.DATE,
    value: (row) => row.lastNotifiedAt,
    sortable: true,
    width: '140px',
  },
];
