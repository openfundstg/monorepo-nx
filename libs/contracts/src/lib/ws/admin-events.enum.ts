/**
 * Socket.io event names on the `/admin` namespace.
 *
 * A third namespace alongside `/extension` and `/tma`, and separate for the
 * same reason those two are: an admin room carries every user's traffic, which
 * is precisely what must never reach either of the other two.
 *
 * The panel is not the origin of any of these. Each one is a fan-out of
 * something the system was already doing — a trader event on the `ws.emit` bus,
 * a Mini App push, or an admin's own write — so adding a member here means
 * finding the place that already knows, never adding a new source of truth.
 */
export enum AdminWsEventNames {
  /** A TMA user's row changed — balance, activity flag, turnover. */
  USER_UPDATED = 'admin.user_updated',
  /** A sale moved: status, progress, jar balance, settlement. */
  SALE_UPDATED = 'admin.sale_updated',
  DEPOSIT_UPDATED = 'admin.deposit_updated',
  FIAT_DEPOSIT_UPDATED = 'admin.fiat_deposit_updated',
  /** A terminal's balance, goal or enabled/accepting flags moved. */
  TERMINAL_UPDATED = 'admin.terminal_updated',
  ALERT_UPDATED = 'admin.alert_updated',
  /**
   * A scraper history row was written for some terminal.
   *
   * Carries `TerminalHistoryUpdatedDto` unchanged — the same payload the
   * trader's own extension receives on `WsEventNames.TERMINAL_HISTORY_UPDATED`,
   * because both render it through the same shared table. The panel filters by
   * `cardId` client-side; there is no per-terminal room, since an operator
   * watches one jar at a time and a room per terminal would need join/leave
   * plumbing on every navigation.
   */
  TERMINAL_HISTORY_APPENDED = 'admin.terminal_history_appended',
  /** An admin did something that changes state. Also how a second tab finds out. */
  AUDIT_LOGGED = 'admin.audit_logged',
  /** One overview counter moved — see {@link AdminOverviewDeltaEvent}. */
  OVERVIEW_DELTA = 'admin.overview_delta',
}
