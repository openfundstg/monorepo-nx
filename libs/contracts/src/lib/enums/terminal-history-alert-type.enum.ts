export enum TerminalHistoryAlertType {
  SAFE_TRANSFER = 'SAFE_TRANSFER',
  ALERT_RESOLVED = 'ALERT_RESOLVED',
  TERMINAL_FULL_WARNING = 'TERMINAL_FULL_WARNING',
  FRAUD_SUSPICION = 'FRAUD_SUSPICION',
  UNRECOGNIZED_DEPOSIT = 'UNRECOGNIZED_DEPOSIT',
  AMBIGUOUS_DEPOSIT = 'AMBIGUOUS_DEPOSIT',
  FRAUD = 'FRAUD',
  ORDER_CONFIRMATION_FAILED = 'ORDER_CONFIRMATION_FAILED',
  /**
   * A Mini App sale finished, and the terminal is being retired.
   *
   * Not an alert — nothing is wrong and there is nothing to act on. It shares
   * this channel because the terminal history has exactly one place for
   * "something happened to this terminal that was not an order changing state",
   * and `ALERT_RESOLVED` already sits here on the same footing.
   *
   * It is the last entry a Mini App terminal ever gets. Without it the feed
   * simply stopped: the final order matched, and then nothing, with no way to
   * tell a finished sale from one whose scraper had died.
   */
  SALE_COMPLETED = 'SALE_COMPLETED',
}
