/** One destination in the sidebar. */
export interface NavItem {
  readonly path: string;
  /** Translation key. */
  readonly label: string;
  readonly icon: string;
  /**
   * Whether the link is active only on an exact URL match.
   *
   * True for the overview alone: its path is `''`, which prefix-matches every
   * other route and would otherwise leave the whole sidebar highlighted.
   */
  readonly exact?: boolean;
}

/** A labelled group of destinations. */
export interface NavSection {
  /** Translation key. */
  readonly label: string;
  readonly items: readonly NavItem[];
}

/**
 * The sidebar, grouped by whose world each screen belongs to.
 *
 * **Fourteen destinations, down from fifteen, and two of them do the work of
 * four.** The split that was removed was ours rather than the product's: sales
 * on a jar and sales to a card are one book read two ways, and so are USDT and
 * hryvnia top-ups. Four entries meant an operator answering "has this person
 * ever topped up" had to open two screens and remember to — and the dispute
 * queue, on a screen of its own, could be reached from a Transacto order number
 * but led nowhere near the sale around it. Each of those is now a chip on one
 * list.
 *
 * What was added is the archive: every file that has passed through this
 * product, whatever it answered. It is the one thing none of the old screens
 * could show, because a statement was reachable only through its dispute and a
 * receipt only through a counterparty's own panel.
 *
 * Grouped rather than flat because fourteen destinations in one column is a
 * list nobody scans — and the four groups are genuinely different systems: the
 * overview, the Mini App's users and their money, the trader-side payment
 * pipeline, and the operator's own record of what was done.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'nav.section_overview',
    items: [{ path: '', label: 'nav.overview', icon: 'dashboard', exact: true }],
  },
  {
    label: 'nav.section_tma',
    items: [
      { path: 'users', label: 'nav.users', icon: 'group' },
      // Both methods and the dispute queue, cut by chips.
      { path: 'sales', label: 'nav.sales', icon: 'sync_alt' },
      // Both rails — USDT and hryvnia — cut by chips.
      { path: 'deposits', label: 'nav.deposits', icon: 'account_balance_wallet' },
      // Every statement and every receipt, each pointing back at what it answered.
      { path: 'documents', label: 'nav.documents', icon: 'description' },
      {
        path: 'fiat-deposit-watches',
        label: 'nav.fiat_deposit_watches',
        icon: 'notifications_active',
      },
      { path: 'referrals', label: 'nav.referrals', icon: 'share' },
    ],
  },
  {
    label: 'nav.section_pipeline',
    items: [
      { path: 'terminals', label: 'nav.terminals', icon: 'point_of_sale' },
      { path: 'orders', label: 'nav.orders', icon: 'receipt_long' },
      { path: 'traders', label: 'nav.traders', icon: 'badge' },
      { path: 'alerts', label: 'nav.alerts', icon: 'warning' },
      { path: 'safe-box', label: 'nav.safe_box', icon: 'lock' },
    ],
  },
  {
    label: 'nav.section_ops',
    items: [
      { path: 'support', label: 'nav.support', icon: 'support_agent' },
      { path: 'audit', label: 'nav.audit', icon: 'history' },
    ],
  },
];
