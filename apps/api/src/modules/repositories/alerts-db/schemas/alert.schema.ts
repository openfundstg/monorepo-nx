import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose'
import { AlertType, AlertStatus, type AlertMetadata } from '@transacto/contracts'

export type AlertDocument = HydratedDocument<Alert>

// Both travel to the extension in the alert events, so contracts owns them.
export { AlertType, AlertStatus }

@Schema({ timestamps: true, collection: 'alerts', versionKey: false })
export class Alert {
  @Prop({ type: Number, required: true, index: true })
  traderId: number

  @Prop({ type: Number, required: true })
  terminalId: number

  @Prop({ type: String, enum: AlertType, required: true })
  type: AlertType

  @Prop({ type: Number, required: true })
  amount: number

  @Prop({ type: String, enum: AlertStatus, default: AlertStatus.PENDING })
  status: AlertStatus

  @Prop({ type: Boolean, default: false })
  isRead: boolean

  /**
   * Interpolation parameters for the translation keyed by {@link type}.
   *
   * There is no `message` column on purpose. A rendered sentence in the
   * database is frozen in whichever language wrote it, and duplicating rows per
   * locale is worse — so an alert is stored as a key plus its data and the
   * client renders it. Every field a translation interpolates must be present
   * here; see `AlertMetadataMap` in contracts for the shape per type.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: AlertMetadata

  createdAt: Date
  updatedAt: Date
}

export const AlertSchema = SchemaFactory.createForClass(Alert)
