import { AdminSaleAction, AdminSaleFilter, type AdminSaleListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction, RowLink } from '../../shared/interfaces';
import type { FilterChip } from '../../shared/components';
import {
  cardOrderTone,
  documentsForLink,
  unknownTone,
  ordersLink,
  saleLink,
  saleTone,
  terminalHistoryLink,
  traderLink,
  userLink,
} from '../../shared/utils';

/**
 * The three slices of the sales book.
 *
 * **The dispute queue is one of them rather than a screen**, which is the whole
 * point of the merge. An operator arriving from Transacto's panel holding an
 * order number used to land on a list that could find the dispute and nothing
 * around it — not the seller, not the stake, not the terminal. Here the same
 * number finds the sale, and the queue is a chip away.
 */
export const SALE_FILTERS: readonly FilterChip[] = [
  { value: null, label: 'sales.filter_all' },
  { value: AdminSaleFilter.JAR, label: 'sales.filter_jar' },
  { value: AdminSaleFilter.CARD, label: 'sales.filter_card' },
  { value: AdminSaleFilter.DISPUTED, label: 'sales.filter_disputed' },
];

/**
 * A sale, with the three figures that say what it is doing:
 * the target, what the pipeline has matched, and what the bank says is in the
 * jar.
 *
 * All three, not one. `receivedAmount` is the audited figure the order settles
 * on; `jarBalance` is what the user sees in their banking app. They diverge
 * routinely — money can sit in a jar with no order accounting for it — and a
 * screen showing only one cannot explain a complaint about the other.
 *
 * **`jarBalance` is empty on every card sale and that is not a gap.** A card
 * sale has no jar; what it has is an order somebody has to answer for, which is
 * the `dispute` column instead.
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
    /**
     * The code a seller quotes to support, and the way into the sale's page.
     *
     * First link in every row, because every question about a sale is answered
     * on that page and nowhere else.
     */
    key: 'publicId',
    header: 'sales.public_id',
    type: ColumnType.ROUTER_LINK,
    value: (order) => order.publicId,
    link: (order) => saleLink(order.id, order.publicId),
    width: '110px',
  },
  {
    key: 'saleMethod',
    header: 'sales.method',
    type: ColumnType.CHIP,
    value: (order) => order.saleMethod,
    translatePrefix: 'SALE_METHOD',
    // Neither method is better than the other, so neither is toned: the chip is
    // here to be read, not to alarm.
    tone: unknownTone,
    width: '110px',
  },
  {
    key: 'username',
    header: 'sales.user',
    type: ColumnType.ROUTER_LINK,
    value: (order) => order.username,
    link: (order) => userLink(order.telegramId, order.username),
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
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (order) => order.status,
    tone: (order) => saleTone(order.status),
    translatePrefix: 'SALE_STATUS',
    sortable: true,
  },
  {
    /**
     * Where the card order this sale is answering for stands.
     *
     * Empty on a jar sale and on a card sale with nothing outstanding — which
     * is most of them, and is why this is one column rather than the five the
     * dispute screen used to carry.
     */
    key: 'cardOrder',
    header: 'sales.dispute',
    type: ColumnType.CHIP,
    value: (order) => order.cardOrder?.state ?? null,
    tone: (order) => (order.cardOrder ? cardOrderTone(order.cardOrder.state) : unknownTone()),
    translatePrefix: 'SALE_CARD_ORDER',
    width: '150px',
  },
  {
    /**
     * Everything this sale is connected to.
     *
     * One cell rather than four columns, because which links a row has depends
     * on what kind of sale it is: a jar sale has a terminal and a history, a
     * card sale has a Transacto order and the documents sent about it. A column
     * per possibility would be a table of empty cells.
     */
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (order) => saleRefs(order),
    width: '200px',
  },
];

/** Where one sale's row can take an operator. */
const saleRefs = (order: AdminSaleListItem): readonly RowLink[] => [
  ...(order.cardId === null ? [] : [terminalHistoryLink(order.cardId)]),
  ...(order.cardId === null ? [] : [ordersLink(order.cardId)]),
  ...(order.traderId === null ? [] : [traderLink(order.traderId)]),
  // The dispute's own order number, which is what an operator settling an
  // appeal in Transacto's panel is holding.
  ...(order.cardOrder === null ? [] : [ordersLink(order.cardOrder.orderId)]),
  ...(order.statementCount === 0
    ? []
    : [documentsForLink(order.publicId, order.statementCount)]),
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
  // Only on a finished sale still holding its slot. **Read, never re-derived**:
  // `allowedSaleActions` already weighs the status, `jarClosedAt` *and* the
  // sale method — a card sale has no jar to release — and a second copy of that
  // here is precisely the drift the note above describes.
  {
    id: AdminSaleAction.RELEASE_JAR,
    label: 'sales.release_jar',
    icon: 'savings',
    visible: accepts(AdminSaleAction.RELEASE_JAR),
    destructive: true,
  },
];
