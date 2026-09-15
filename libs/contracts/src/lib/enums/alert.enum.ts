/**
 * Alert classification, persisted on the backend and carried verbatim in the
 * TERMINAL_ALERT_TRIGGERED / TERMINAL_ALERT_RESOLVED events.
 *
 * Distinct from `TerminalHistoryAlertType`, which is the wider set recorded
 * inside a history entry.
 */
export enum AlertType {
  AMBIGUOUS_DEPOSIT = 'AMBIGUOUS_DEPOSIT',
  UNRECOGNIZED_DEPOSIT = 'UNRECOGNIZED_DEPOSIT',
  FRAUD = 'FRAUD',
  TERMINAL_FULL_WARNING = 'TERMINAL_FULL_WARNING',
  /**
   * The money arrived and matched, but Transacto refused to confirm the order.
   *
   * Raised only for `orders_execute` error 108, "Insufficient trader limit".
   * The order is credited locally regardless — the hryvnia is demonstrably in
   * the jar — so this is a standing reminder that the confirmation still has to
   * happen in the Transacto cabinet, not a report that anything was lost.
   */
  ORDER_CONFIRMATION_FAILED = 'ORDER_CONFIRMATION_FAILED',
}

export enum AlertStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
}
