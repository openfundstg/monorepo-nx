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
 * Grouped rather than flat because twelve destinations in one column is a list
 * nobody scans — and the three groups are genuinely different systems: the Mini
 * App's users, the trader-side payment pipeline, and the operator's own record
 * of what was done.
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
      { path: 'sales', label: 'nav.sales', icon: 'sync_alt' },
      { path: 'deposits', label: 'nav.deposits', icon: 'account_balance_wallet' },
      { path: 'fiat-deposits', label: 'nav.fiat_deposits', icon: 'payments' },
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
