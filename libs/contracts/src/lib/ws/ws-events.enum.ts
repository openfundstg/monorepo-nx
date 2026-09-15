/**
 * Socket.io event names shared by the backend gateways and every frontend client.
 * Renaming a member here breaks both sides at compile time — which is the point.
 */
export enum WsEventNames {
  TERMINAL_ENABLED = 'terminal.enabled',
  TERMINAL_DISABLED = 'terminal.disabled',
  TERMINAL_HISTORY_UPDATED = 'history.new_record',
  TERMINAL_BALANCE_UPDATED = 'terminal.balance_updated',
  TERMINAL_ALERT_RESOLVED = 'terminal.alert_resolved',
  TERMINAL_ALERT_TRIGGERED = 'terminal.alert_triggered',
  TRADER_DEACTIVATED = 'trader.deactivated',
}
