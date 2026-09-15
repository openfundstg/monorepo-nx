import { AdminSaleAction } from '@transacto/contracts';
import type { AdminSaleListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction } from '../../shared/interfaces';
import { saleTone } from '../../shared/utils';

/**
 * A sale, with the three figures that say what it is doing:
 * the target, what the pipeline has matched, and what the bank says is in the
 * jar.
 *
 * All three, not one. `receivedAmount` is the audited figure the order settles
 * on; `jarBalance` is what the user sees in their banking app. They diverge
 * routinely — money can sit in a jar with no order accounting for it — and a
 * screen showing only one cannot explain a complaint about the other.
 */
export const SALE_COLUMNS: readonly ColumnDef<AdminSaleListItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (order) => order.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'publicId',
    header: 'sales.public_id',
    type: ColumnType.MONO,
    value: (order) => order.publicId,
    width: '100px',
  },
  {
    key: 'username',
    header: 'sales.user',
    type: ColumnType.TEXT,
    value: (order) => order.username,
  },
  {
    key: 'fiatAmount',
    header: 'sales.target',
    type: ColumnType.UAH,
    value: (order) => order.fiatAmount,
    sortable: true,
  },
  {
    key: 'receivedAmount',
    header: 'sales.received',
    type: ColumnType.UAH,
    value: (order) => order.receivedAmount,
    sortable: true,
  },
  {
    key: 'jarBalance',
    header: 'sales.jar',
    type: ColumnType.UAH,
    value: (order) => order.jarBalance,
  },
  {
    key: 'frozenUsdt',
    header: 'sales.stake',
    type: ColumnType.USDT,
    value: (order) => order.frozenUsdt,
  },
  {
    key: 'bankType',
    header: 'sales.bank',
    type: ColumnType.TEXT,
    value: (order) => order.bankType,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (order) => order.status,
    tone: (order) => saleTone(order.status),
    translatePrefix: 'SALE_STATUS',
    sortable: true,
  },
  {
    key: 'dropLink',
    header: 'sales.drop_link',
    type: ColumnType.LINK,
    value: (order) => order.dropLink,
  },
  {
    key: 'cardId',
    header: 'common.card_id',
    type: ColumnType.NUMBER,
    value: (order) => order.cardId,
  },
];

/**
 * The row says which interventions it accepts; this only reads it.
 *
 * The rule is not derivable from `status` alone — cancelling refuses an order
 * that is already winding down while blocking and completing accept it, and a
 * blocked order accepts none of the three. Those preconditions live in the
 * backend's settlement services, so the backend is what answers, per row, in
 * `allowedActions`. A copy of the rule here drifted the moment it was written:
 * it offered all three on a blocked order, where one answered 409 and two
 * silently did nothing.
 */
const accepts =
  (action: AdminSaleAction) =>
  (order: AdminSaleListItem): boolean =>
    order.allowedActions.includes(action);

export const SALE_ROW_ACTIONS: readonly RowAction<AdminSaleListItem>[] = [
  {
    id: AdminSaleAction.CANCEL,
    label: 'sales.cancel',
    icon: 'cancel',
    visible: accepts(AdminSaleAction.CANCEL),
    destructive: true,
  },
  {
    id: AdminSaleAction.BLOCK,
    label: 'sales.block',
    icon: 'gpp_bad',
    visible: accepts(AdminSaleAction.BLOCK),
    destructive: true,
  },
  {
    id: AdminSaleAction.COMPLETE,
    label: 'sales.complete',
    icon: 'task_alt',
    visible: accepts(AdminSaleAction.COMPLETE),
  },
  // The two halves of a review. They appear only on a blocked order, which
  // accepts nothing else — see `allowedSaleActions` on the backend.
  {
    id: AdminSaleAction.RESUME,
    label: 'sales.resume',
    icon: 'play_circle',
    visible: accepts(AdminSaleAction.RESUME),
  },
  {
    id: AdminSaleAction.RELEASE,
    label: 'sales.release',
    icon: 'lock_open',
    visible: accepts(AdminSaleAction.RELEASE),
    destructive: true,
  },
  // Only on a finished sale still holding its slot — the backend adds it to
  // `allowedActions` when the sale has a jar nothing has reported closed.
  {
    id: AdminSaleAction.RELEASE_JAR,
    label: 'sales.release_jar',
    icon: 'savings',
    visible: accepts(AdminSaleAction.RELEASE_JAR),
    destructive: true,
  },
];
