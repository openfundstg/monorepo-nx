import type { OrderStatus, OrderExecutionReason } from '../enums/order-status.enum.js';
import type { TerminalHistoryAlertType } from '../enums/terminal-history-alert-type.enum.js';

export interface TerminalHistoryOrderEvent {
  orderId: number;
  amount: number;
  status: OrderStatus;
  executionReason?: OrderExecutionReason;
}

export interface TerminalHistoryAlert {
  type: TerminalHistoryAlertType;
  details?: Record<string, unknown>;
}

export interface TerminalHistory {
  _id?: string;
  cardId: number;
  traderId: number;
  timestamp: string | Date;
  balance: number;
  baseline: number;
  expectedBalance: number;
  delta: number;
  orderEvents: TerminalHistoryOrderEvent[];
  alerts: TerminalHistoryAlert[];
}
