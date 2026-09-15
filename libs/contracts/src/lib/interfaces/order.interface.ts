import type { OrderStatus, OrderExecutionReason } from '../enums/order-status.enum.js';

export interface Order {
  orderId: number;
  orderStringId?: string;
  traderId: number;
  cardId: number;
  amount: number;
  actualAmount?: number;
  status: OrderStatus;
  executionReason?: OrderExecutionReason;
  enqueuedAt?: string | Date;
  lastSyncAt?: string | Date;
}
