import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type TraderDocument = HydratedDocument<Trader>

@Schema({ timestamps: true, collection: 'traders', versionKey: false })
export class Trader {
  @Prop({ type: Number, unique: true, required: true, index: true })
  traderId: number

  @Prop({ type: String, required: true })
  apiToken: string

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const TraderSchema = SchemaFactory.createForClass(Trader)
