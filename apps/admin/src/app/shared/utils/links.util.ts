import { AdminDepositKind, AdminDocumentKind, AdminSaleFilter } from '@transacto/contracts';
import type { RowLink } from '../interfaces/column-def.interface';

/**
 * Every link one screen makes to another, built in one place.
 *
 * **The panel's whole navigability is these functions.** Before them an
 * operator followed an id by selecting it, going to another screen and pasting
 * it into a search box — which is why nobody did, and why a question that spans
 * two entities took four navigations to answer. A link is cheap; not having one
 * is what costs.
 *
 * They live here rather than beside each list for two reasons. A route that
 * moves is then a compile error at one place instead of a dead link somebody
 * finds in production. And the label and tooltip of "the terminal this row is
 * routed through" are written once, so the chip reads the same on a sale, on an
 * order and on an alert — which is what lets an operator learn the panel once.
 *
 * Every one of them carries `search` or `filter` as a query parameter, which
 * the destination applies through `bindListQuery`. A link that merely opened a
 * list would be a link to a haystack.
 */

// --- People ----------------------------------------------------------------

/** One user's own page. */
export const userLink = (telegramId: number, label?: string | number): RowLink => ({
  label: label ?? telegramId,
  commands: ['/users', telegramId],
  icon: 'person',
  tooltip: 'links.user',
});

/** Everything this person sold. */
export const userSalesLink = (telegramId: number): RowLink => ({
  label: 'links.sales',
  translate: true,
  commands: ['/sales'],
  queryParams: { search: telegramId },
  icon: 'sync_alt',
  tooltip: 'links.user_sales',
});

/** Everything this person paid in, on either rail. */
export const userDepositsLink = (telegramId: number): RowLink => ({
  label: 'links.deposits',
  translate: true,
  commands: ['/deposits'],
  queryParams: { search: telegramId },
  icon: 'account_balance_wallet',
  tooltip: 'links.user_deposits',
});

/** Every document this person has sent. */
export const userDocumentsLink = (telegramId: number): RowLink => ({
  label: 'links.documents',
  translate: true,
  commands: ['/documents'],
  queryParams: { search: telegramId },
  icon: 'description',
  tooltip: 'links.user_documents',
});

/** Their referral ledger, either side of it. */
export const userReferralsLink = (telegramId: number): RowLink => ({
  label: 'links.referrals',
  translate: true,
  commands: ['/referrals'],
  queryParams: { search: telegramId },
  icon: 'share',
  tooltip: 'links.user_referrals',
});

/** Their support thread, if they have ever written to the bot. */
export const userSupportLink = (telegramId: number): RowLink => ({
  label: 'links.support',
  translate: true,
  commands: ['/support'],
  queryParams: { search: telegramId },
  icon: 'support_agent',
  tooltip: 'links.user_support',
});

/** What operators have done to this person or their money. */
export const userAuditLink = (telegramId: number): RowLink => ({
  label: 'links.audit',
  translate: true,
  commands: ['/audit'],
  queryParams: { search: telegramId },
  icon: 'history',
  tooltip: 'links.user_audit',
});

// --- Sales -----------------------------------------------------------------

/** One sale's own page. */
export const saleLink = (saleId: string, label?: string | number): RowLink => ({
  label: label ?? saleId,
  commands: ['/sales', saleId],
  icon: 'sync_alt',
  tooltip: 'links.sale',
});

/** The dispute queue — card orders waiting on a person. */
export const disputedSalesLink = (): RowLink => ({
  label: 'links.disputes',
  translate: true,
  commands: ['/sales'],
  queryParams: { filter: AdminSaleFilter.DISPUTED },
  icon: 'gavel',
  tooltip: 'links.disputes',
});

// --- Deposits --------------------------------------------------------------

/** One deposit's own page, on whichever rail it came over. */
export const depositLink = (
  kind: AdminDepositKind,
  id: string,
  label?: string | number,
): RowLink => ({
  label: label ?? id,
  commands: ['/deposits', kind, id],
  icon: kind === AdminDepositKind.FIAT ? 'payments' : 'currency_bitcoin',
  tooltip: 'links.deposit',
});

// --- Documents -------------------------------------------------------------

/** The archive, narrowed to one sale, one top-up or one order. */
export const documentsForLink = (search: string | number, count: number): RowLink => ({
  label: count,
  commands: ['/documents'],
  queryParams: { search },
  icon: 'description',
  tooltip: 'links.documents_for',
});

/** Only statements, or only receipts. */
export const documentsOfKindLink = (kind: AdminDocumentKind): RowLink => ({
  label: kind === AdminDocumentKind.SALE_STATEMENT ? 'links.statements' : 'links.receipts',
  translate: true,
  commands: ['/documents'],
  queryParams: { filter: kind },
  icon: 'description',
  tooltip: 'links.documents',
});

// --- The payment pipeline --------------------------------------------------

/**
 * A terminal's scraping history.
 *
 * By `cardId`, because that is what a terminal is filed under and what its
 * history rows are keyed by — see the note on the route.
 */
export const terminalHistoryLink = (cardId: number): RowLink => ({
  label: cardId,
  commands: ['/terminals', cardId, 'history'],
  icon: 'history',
  tooltip: 'links.terminal_history',
});

/** The terminals list, narrowed to one card, trader or terminal id. */
export const terminalLink = (search: number, label?: string | number): RowLink => ({
  label: label ?? search,
  commands: ['/terminals'],
  queryParams: { search },
  icon: 'point_of_sale',
  tooltip: 'links.terminal',
});

/** Transacto orders, narrowed to one card, trader or order number. */
export const ordersLink = (search: number, label?: string | number): RowLink => ({
  label: label ?? search,
  commands: ['/orders'],
  queryParams: { search },
  icon: 'receipt_long',
  tooltip: 'links.orders',
});

export const traderLink = (traderId: number, label?: string | number): RowLink => ({
  label: label ?? traderId,
  commands: ['/traders'],
  queryParams: { search: traderId },
  icon: 'badge',
  tooltip: 'links.trader',
});

export const alertsLink = (search: number, label?: string | number): RowLink => ({
  label: label ?? search,
  commands: ['/alerts'],
  queryParams: { search },
  icon: 'warning',
  tooltip: 'links.alerts',
});

export const safeBoxLink = (search: number, label?: string | number): RowLink => ({
  label: label ?? search,
  commands: ['/safe-box'],
  queryParams: { search },
  icon: 'lock',
  tooltip: 'links.safe_box',
});

/** The audit trail, narrowed to whatever an action was about. */
export const auditLink = (search: string | number, label?: string | number): RowLink => ({
  label: label ?? search,
  commands: ['/audit'],
  queryParams: { search },
  icon: 'history',
  tooltip: 'links.audit',
});
