import { SaleReceiverNameSource, type AdminCardOrderListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { cardOrderTone } from '../../shared/utils';

/**
 * A disputed card payment, as the operator settling an appeal needs it.
 *
 * **The order number is first**, because it is the only thing an operator
 * arrives holding — it is what Transacto's own panel shows them, and what the
 * search box takes. Everything after it answers "whose, how much, and has a
 * document settled it".
 *
 * **No card number in any form, not even four digits.** Closing an appeal does
 * not need one, and this table is rendered in a browser.
 */
export const CARD_ORDER_COLUMNS: readonly ColumnDef<AdminCardOrderListItem>[] = [
  {
    key: 'orderId',
    header: 'card_orders.order_id',
    type: ColumnType.MONO,
    value: (row) => row.orderId,
  },
  {
    key: 'publicId',
    header: 'card_orders.sale',
    type: ColumnType.MONO,
    value: (row) => row.publicId,
    sortable: true,
  },
  {
    key: 'telegramId',
    header: 'card_orders.telegram_id',
    type: ColumnType.MONO,
    value: (row) => row.telegramId,
  },
  {
    key: 'amount',
    header: 'card_orders.amount',
    type: ColumnType.UAH,
    value: (row) => row.amount,
  },
  {
    key: 'state',
    header: 'card_orders.state',
    type: ColumnType.CHIP,
    value: (row) => row.state,
    translatePrefix: 'SALE_CARD_ORDER',
    // No cast: `row.state` is already the contract enum, and a cast would
    // absorb a member added to it — which is what the tone map's
    // fallback-free `Record` exists to make fail at compile time.
    tone: (row) => cardOrderTone(row.state),
  },
  {
    /**
     * Who the payer was shown, and — through the chip beside it — whether a
     * bank has since confirmed that is whose card it is.
     *
     * The one column worth an operator's eye on its own. A card sale has no
     * drop link to vouch for its destination, so until a statement is accepted
     * this name is only what the seller typed.
     */
    key: 'receiverName',
    header: 'card_orders.receiver',
    type: ColumnType.TEXT,
    value: (row) => row.receiverName,
  },
  {
    key: 'receiverNameSource',
    header: 'card_orders.receiver_proven',
    type: ColumnType.BOOL,
    value: (row) => row.receiverNameSource === SaleReceiverNameSource.STATEMENT,
    width: '120px',
  },
  {
    /**
     * How many documents have been sent about this order.
     *
     * A count rather than the statements themselves: a row carrying them would
     * put the period, the account holder and the account tail of somebody's
     * bank statement into a table nobody reads them from. What an operator
     * opens is the document, through the action beside the row.
     */
    key: 'statements',
    header: 'card_orders.statements',
    type: ColumnType.NUMBER,
    value: (row) => row.statements.length,
    width: '110px',
  },
  {
    key: 'arrivedAt',
    header: 'card_orders.arrived',
    type: ColumnType.DATE,
    value: (row) => row.arrivedAt,
    width: '140px',
  },
];
