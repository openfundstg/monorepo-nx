import type { AdminReferralEarningListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';

/**
 * The referral ledger.
 *
 * `ratePercent` is shown as it is stored — a fraction of a percent, e.g. `0.1`
 * — because that is how the payout was computed. Multiplying it by a hundred
 * for display would say every referrer earned ten percent of a sale,
 * which is two orders of magnitude wrong.
 */
export const REFERRAL_COLUMNS: readonly ColumnDef<AdminReferralEarningListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'referrerUsername',
    header: 'referrals.referrer',
    type: ColumnType.TEXT,
    value: (row) => row.referrerUsername,
  },
  {
    key: 'referredUsername',
    header: 'referrals.referred',
    type: ColumnType.TEXT,
    value: (row) => row.referredUsername,
  },
  {
    key: 'amount',
    header: 'referrals.payout',
    type: ColumnType.USDT,
    value: (row) => row.amount,
    sortable: true,
  },
  {
    key: 'fiatAmount',
    header: 'referrals.source_order',
    type: ColumnType.UAH,
    value: (row) => row.fiatAmount,
    sortable: true,
  },
  {
    key: 'exchangeRate',
    header: 'common.rate',
    type: ColumnType.UAH,
    value: (row) => row.exchangeRate,
  },
  {
    key: 'ratePercent',
    header: 'referrals.rate_percent',
    type: ColumnType.TEXT,
    value: (row) => `${row.ratePercent}%`,
  },
];
