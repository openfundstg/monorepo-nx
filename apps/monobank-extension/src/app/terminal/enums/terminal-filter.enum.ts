/** Which terminals the dashboard is showing. */
export enum TerminalFilter {
  ALL = 'ALL',
  /** Created automatically by the Telegram Mini App. */
  TMA = 'TMA',
  /** Everything else — added by the trader in the Transacto admin panel. */
  OTHER = 'OTHER',
}
