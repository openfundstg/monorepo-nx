import {
  AdminDepositKind,
  AdminDocumentKind,
  type AdminDocumentListItem,
} from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef, RowLink } from '../../shared/interfaces';
import type { FilterChip } from '../../shared/components';
import {
  depositLink,
  documentStatusPrefix,
  documentTone,
  ordersLink,
  saleLink,
  unknownTone,
  userLink,
} from '../../shared/utils';

/** The archive, whole or by kind. */
export const DOCUMENT_FILTERS: readonly FilterChip[] = [
  { value: null, label: 'documents.filter_all' },
  { value: AdminDocumentKind.SALE_STATEMENT, label: 'documents.filter_statements' },
  { value: AdminDocumentKind.FIAT_RECEIPT, label: 'documents.filter_receipts' },
];

/**
 * One document, and what it is about.
 *
 * **The reference column is the reason this screen exists.** A file on its own
 * answers nothing — a statement and a receipt look alike and are evidence of
 * opposite things — so every row says which sale or which top-up it belongs to,
 * and links there.
 *
 * **No account numbers, in any form.** A statement's account tail and a
 * receipt's recipient card are payment credentials, and a list rendered in a
 * browser is not where either belongs.
 */
export const DOCUMENT_COLUMNS: readonly ColumnDef<AdminDocumentListItem>[] = [
  {
    key: 'uploadedAt',
    header: 'documents.uploaded',
    type: ColumnType.DATE,
    value: (row) => row.uploadedAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'kind',
    header: 'documents.kind',
    type: ColumnType.CHIP,
    value: (row) => row.kind,
    translatePrefix: 'DOCUMENT_KIND',
    // Neither kind is better than the other; the chip says which evidence this
    // is, and the status beside it says whether it proved anything.
    tone: unknownTone,
    width: '130px',
  },
  {
    key: 'username',
    header: 'documents.user',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.username,
    link: (row) => userLink(row.telegramId, row.username),
  },
  {
    /**
     * What this document is about — the sale or the top-up, as a link.
     *
     * Exactly one of the two is populated per kind, which is why this is one
     * column rather than two mostly-empty ones.
     */
    key: 'about',
    header: 'documents.about',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.salePublicId ?? (row.payoutId === null ? null : `#${row.payoutId}`),
    link: (row) => aboutLink(row),
    width: '130px',
  },
  {
    key: 'bank',
    header: 'documents.bank',
    type: ColumnType.TEXT,
    value: (row) => row.bank,
    width: '120px',
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (row) => row.status,
    tone: (row) => documentTone(row.kind, row.status),
    translatePrefix: (row) => documentStatusPrefix(row.kind),
    sortable: true,
  },
  {
    /**
     * What a receipt was held to state, in the counterparty's own figure.
     *
     * Empty on a statement, and not because it is unknown: a statement is asked
     * to show that a payment is *absent*, so it states no single sum.
     */
    key: 'amountUah',
    header: 'documents.amount',
    type: ColumnType.UAH,
    value: (row) => row.amountUah,
  },
  {
    /**
     * Whether the bytes are still here.
     *
     * A column rather than a disabled button, because "we never kept this" and
     * "we kept it and its retention ran out" are different answers to give
     * somebody asking about their own money — and both are ordinary.
     */
    key: 'fileAvailable',
    header: 'documents.file',
    type: ColumnType.BOOL,
    value: (row) => row.fileAvailable,
    width: '100px',
  },
  {
    key: 'links',
    header: 'common.related',
    type: ColumnType.REFS,
    value: () => null,
    refs: (row) => documentRefs(row),
    width: '180px',
  },
];

/** The one thing a document is about, as a link. */
const aboutLink = (row: AdminDocumentListItem): RowLink | null => {
  if (row.saleId !== null) return saleLink(row.saleId, row.salePublicId ?? row.saleId);
  if (row.fiatDepositId !== null)
    return depositLink(AdminDepositKind.FIAT, row.fiatDepositId, `#${row.payoutId}`);

  return null;
};

/** The Transacto number behind it — the order it answers, or the payout it pays. */
const documentRefs = (row: AdminDocumentListItem): readonly RowLink[] => [
  ...(row.cardOrderId === null ? [] : [ordersLink(row.cardOrderId)]),
  ...(row.payoutId === null ? [] : [ordersLink(row.payoutId)]),
];
