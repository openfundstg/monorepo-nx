import {
  AdminDepositKind,
  AdminDocumentKind,
  AdminFiatDepositAction,
  isFiatDepositHeld,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  type AdminDepositRowItem,
} from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowAction, RowLink } from '../../shared/interfaces';
import type { FilterOption } from '../../shared/components';
import {
  bankBadge,
  bankRowClass,
  depositLink,
  depositRowTone,
  depositStatusPrefix,
  documentsForLink,
  unknownTone,
  userLink,
} from '../../shared/utils';

/**
 * The two rails, and the whole book.
 *
 * **They were two screens**, and the split was ours rather than the product's:
 * a user tops up with USDT or with hryvnia and thinks of neither as a separate
 * feature. More to the point, the rule that matters most about them treats them
 * as one — a new account is capped at ₴2 000 per top-up until one settled
 * deposit *by either method* lifts it — so a screen showing one rail cannot
 * explain why somebody's cap lifted.
 */
export const DEPOSIT_VARIANTS: readonly FilterOption[] = [
  { value: AdminDepositKind.CRYPTO, label: 'deposits.filter_crypto' },
  { value: AdminDepositKind.FIAT, label: 'deposits.filter_fiat' },
];

/**
 * Every status either rail can be in.
 *
 * Two enums in one list, and no attempt to reconcile them: a deposit is on one
 * rail or the other, so a status belongs to exactly one of them and picking it
 * narrows to that rail anyway. Flattening the two into a third enum would be a
 * status written down in three places and agreeing in two.
 */
export const DEPOSIT_STATUSES: readonly FilterOption[] = [
  ...Object.values(TmaDepositStatus).map((status) => ({
    value: status,
    label: `DEPOSIT_STATUS.${status}`,
  })),
  ...Object.values(TmaFiatDepositStatus).map((status) => ({
    value: status,
    label: `FIAT_DEPOSIT_STATUS.${status}`,
  })),
];

/**
 * One deposit, on whichever rail it came over.
 *
 * **The money is cents on every row**, converted on the server — see
 * `AdminDepositRowItem`. A column reading whichever unit its source used would
 * be a hundredfold error that no type catches, because both are `number`.
 *
 * **No recipient card.** It is a payment credential, it is needed for exactly
 * one errand — reconciling a top-up against Transacto's own panel — and that
 * errand has a page. It is still *searchable*, because searching for a value
 * somebody already holds discloses nothing.
 */
export const DEPOSIT_COLUMNS: readonly ColumnDef<AdminDepositRowItem>[] = [
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    // Neither rail is better than the other; the chip is here to be read.
    key: 'kind',
    header: 'deposits.method',
    type: ColumnType.CHIP,
    value: (row) => row.kind,
    translatePrefix: 'DEPOSIT_KIND',
    tone: unknownTone,
    width: '110px',
  },
  {
    /**
     * Where the hryvnia came from, once a receipt has said so.
     *
     * Empty on the crypto rail and on a top-up nobody has sent a receipt for —
     * neither is a gap. USDT has no bank, and an unpaid top-up has not yet
     * named one.
     */
    key: 'bank',
    header: 'deposits.bank',
    type: ColumnType.CHIP,
    value: (row) => row.bank,
    tone: unknownTone,
    badgeClass: (row) => bankBadge(row.bank),
    width: '110px',
  },
  {
    key: 'username',
    header: 'deposits.user',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.username,
    link: (row) => userLink(row.telegramId, row.username),
  },
  {
    key: 'cryptoCents',
    header: 'deposits.credited',
    type: ColumnType.USDT,
    value: (row) => row.cryptoCents,
    sortable: true,
  },
  {
    key: 'fiatAmount',
    header: 'deposits.fiat',
    type: ColumnType.UAH,
    value: (row) => row.fiatAmount,
    sortable: true,
  },
  {
    /**
     * How much of a hryvnia top-up has actually been proven.
     *
     * Empty on the crypto rail — `null` rather than zero, because a crypto
     * deposit is not paid in parts and "none of it has arrived" is not a state
     * it has.
     */
    key: 'coveredUah',
    header: 'deposits.covered',
    type: ColumnType.UAH,
    value: (row) => row.coveredUah,
  },
  {
    /**
     * Two enums in one column, discriminated by the row's rail.
     *
     * The prefix is a function for the same reason the tone is: flattening the
     * two into a third status enum would be a status written down in three
     * places and agreeing in two.
     */
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (row) => row.status,
    tone: (row) => depositRowTone(row.kind, row.status),
    translatePrefix: (row) => depositStatusPrefix(row.kind),
    sortable: true,
  },
  {
    /**
     * The payout this top-up is settling, in Transacto's own numbering.
     *
     * **Plain text, and that is the point.** A payout is not an order — they
     * are separate entities in Transacto with separate numbering, and this
     * panel has no payouts screen — so the number is here to be read across to
     * Transacto's panel by hand, not followed. It was a link into the orders
     * list, which found either nothing or the wrong thing.
     */
    key: 'payoutId',
    header: 'deposits.payout',
    type: ColumnType.TEXT,
    value: (row) => row.payoutId,
    width: '120px',
  },
  {
    key: 'documentCount',
    header: 'deposits.documents',
    type: ColumnType.ROUTER_LINK,
    value: (row) => (row.documentCount === 0 ? null : row.documentCount),
    // Narrowed to receipts: the archive searches by payout *and* order number,
    // and a statement filed under the same integer is a different sale.
    link: (row) =>
      row.documentCount === 0 || row.payoutId === null
        ? null
        : documentsForLink(row.payoutId, row.documentCount, AdminDocumentKind.FIAT_RECEIPT),
    width: '110px',
  },
  {
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (row) => depositRefs(row),
    width: '190px',
  },
];

/**
 * Where one deposit's row can take an operator.
 *
 * The payout number is deliberately not among them — see the `payoutId` column.
 */
const depositRefs = (row: AdminDepositRowItem): readonly RowLink[] => [
  depositLink(row.kind, row.id, 'links.open'),
];

/**
 * The two interventions, and only on the hryvnia rail.
 *
 * **A crypto deposit offers none on purpose.** It settles against a blockchain
 * transaction, and the honest correction for one that went wrong is an audited
 * balance adjustment on the user — not editing a deposit into a state the chain
 * does not support. Hiding the menu is how the screen says so.
 *
 * **The rule itself is `isFiatDepositHeld`, from contracts.** That predicate's
 * own doc comment states it is the set an operator can still act on — the
 * payout is still ours in every one of those statuses — so restating the three
 * members here would be a copy of a rule that already has a home, and the copy
 * is what drifts. The backend re-checks regardless: the row may have moved
 * since it was drawn, because the reconciler runs every thirty seconds.
 */
const actionable = (row: AdminDepositRowItem): boolean =>
  row.kind === AdminDepositKind.FIAT && isFiatDepositHeld(row.status as TmaFiatDepositStatus);

export const DEPOSIT_ROW_ACTIONS: readonly RowAction<AdminDepositRowItem>[] = [
  {
    id: AdminFiatDepositAction.COMPLETE,
    label: 'deposits.complete',
    icon: 'task_alt',
    visible: actionable,
  },
  {
    id: AdminFiatDepositAction.RELEASE,
    label: 'deposits.release',
    icon: 'undo',
    visible: actionable,
    destructive: true,
  },
];

/** The tint a deposit's row carries — see `saleRowClass` for the reasoning. */
export const depositRowClass = (row: AdminDepositRowItem): string | null =>
  bankRowClass(row.bank);
