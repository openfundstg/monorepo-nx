import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema } from 'mongoose'

import { OrderStatus, OrderExecutionReason, TerminalHistoryAlertType } from '@transacto/contracts'

@Schema({ _id: false, versionKey: false })
export class TerminalHistoryOrderEvent {
  @Prop({ required: true })
  orderId: number

  @Prop({ required: true })
  amount: number

  @Prop({ type: String, enum: OrderStatus, required: true })
  status: OrderStatus

  @Prop({ type: String, enum: OrderExecutionReason, required: false })
  executionReason?: OrderExecutionReason
}
export const TerminalHistoryOrderEventSchema =
  SchemaFactory.createForClass(TerminalHistoryOrderEvent)

// Travels to the extension inside history entries, so contracts owns it.
export { TerminalHistoryAlertType }

@Schema({ _id: false, versionKey: false })
export class TerminalHistoryAlert {
  @Prop({ type: String, enum: TerminalHistoryAlertType, required: true })
  type: TerminalHistoryAlertType

  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: Record<string, unknown>
}
export const TerminalHistoryAlertSchema = SchemaFactory.createForClass(TerminalHistoryAlert)

export type TerminalHistoryDocument = TerminalHistory & Document

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'history',
  versionKey: false
})
export class TerminalHistory {
  @Prop({ required: true, index: true })
  cardId: number

  @Prop({ required: true, index: true })
  traderId: number

  @Prop({ default: Date.now })
  timestamp: Date

  @Prop({ required: true })
  balance: number

  @Prop({ required: true })
  baseline: number

  @Prop({ required: true })
  expectedBalance: number

  @Prop({ required: true })
  delta: number

  @Prop({ type: [TerminalHistoryOrderEventSchema], default: [] })
  orderEvents: TerminalHistoryOrderEvent[]

  @Prop({ type: [TerminalHistoryAlertSchema], default: [] })
  alerts: TerminalHistoryAlert[]

  createdAt: Date
}

export const TerminalHistorySchema = SchemaFactory.createForClass(TerminalHistory)

// Compound index for optimizing the dashboard query
TerminalHistorySchema.index({ cardId: 1, timestamp: -1 })
TerminalHistorySchema.index({ traderId: 1, cardId: 1 })
