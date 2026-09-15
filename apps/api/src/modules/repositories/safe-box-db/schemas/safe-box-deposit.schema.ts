import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type SafeBoxDepositDocument = HydratedDocument<SafeBoxDeposit>

export enum SafeBoxStatus {
  HELD = 'HELD',
  IN_APPEAL = 'IN_APPEAL',
  APPLIED = 'APPLIED',
  REFUNDED = 'REFUNDED',
  WRITTEN_OFF = 'WRITTEN_OFF'
}

@Schema({ timestamps: true, collection: 'safe_box_deposits', versionKey: false })
export class SafeBoxDeposit {
  @Prop({ type: Number, required: true, index: true })
  traderId: number

  @Prop({ type: Number, required: true, index: true })
  terminalId: number

  @Prop({ type: Number, required: true, index: true })
  amount: number

  @Prop({ type: Number })
  originalDelta?: number

  @Prop({ type: String, enum: SafeBoxStatus, default: SafeBoxStatus.HELD })
  status: SafeBoxStatus

  @Prop({ type: String })
  comment?: string

  @Prop({ type: Number, index: true })
  linkedOrderId?: number

  @Prop({ type: Date, default: () => new Date() })
  alertCreatedAt: Date

  createdAt: Date
  updatedAt: Date
}

export const SafeBoxDepositSchema = SchemaFactory.createForClass(SafeBoxDeposit)
