import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { OrderStatus, OrderExecutionReason } from '@transacto/contracts'

export type OrderDocument = HydratedDocument<Order>

// Both travel to the extension inside terminal history and order events, so
// @transacto/contracts owns them.
export { OrderStatus, OrderExecutionReason }

@Schema({ timestamps: true, collection: 'orders', versionKey: false })
export class Order {
  /** Internal numeric CRM order ID */
  @Prop({ type: Number, required: true, unique: true, index: true })
  orderId: number

  @Prop({ type: String, required: true })
  orderStringId: string

  @Prop({ type: Number, required: true })
  traderId: number

  @Prop({ type: Number, required: true })
  cardId: number

  @Prop({ type: Number, required: true })
  amount: number

  @Prop({ type: Number, required: false })
  actualAmount?: number

  @Prop({ type: Date, default: () => new Date() })
  enqueuedAt: Date

  @Prop({ type: Date, default: () => new Date() })
  lastSyncAt: Date

  /**
   * When Transacto's window for the payer closes.
   *
   * Their `deadline`, resolved onto our clock — see `payerWindowMs` for why it
   * is carried as a window rather than as their timestamp. Only a card sale
   * reads it: a jar order is settled by the scraper seeing the money, and a
   * deadline it passed changes nothing, while a card order's whole lifecycle
   * turns on it. Absent when the delivery carried no usable pair of
   * timestamps, and the card order then falls back to a configured window.
   */
  @Prop({ type: Date, required: false })
  payerDeadlineAt?: Date

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus

  @Prop({ type: String, enum: OrderExecutionReason, required: false })
  executionReason?: OrderExecutionReason

  /**
   * When this order turned EXECUTED here, by whichever path settled it.
   *
   * What the admin overview dates a day's confirmed volume by. `updatedAt`
   * cannot do it — every sync pass writes `lastSyncAt` and moves it — and
   * `createdAt` is when the payer was routed, not when the money arrived.
   *
   * Absent on orders settled before the field existed; readers fall back to
   * `createdAt`, which for an order that lives minutes is the same day in all
   * but a handful of cases around midnight.
   */
  @Prop({ type: Date, required: false })
  executedAt?: Date

  /**
   * When this process asked Transacto to execute the order.
   *
   * **It exists to recognise our own echo.** Transacto fires an `order.paid`
   * webhook the moment `orders_execute` succeeds, so every order the matcher
   * settles comes straight back as "paid" — often before the matcher has
   * finished writing its own reason. Without this marker that webhook is
   * indistinguishable from an operator confirming a payment by hand, and the
   * consequences were not cosmetic: every automatic match was recorded as
   * `ADMIN_PANEL` and shown to the user as "confirmed manually", and the
   * baseline was advanced for money that had not arrived yet, pushing the
   * expected balance above the real one.
   *
   * Absent on orders settled entirely upstream, which is exactly what makes a
   * manual confirmation identifiable.
   */
  @Prop({ type: Date, required: false })
  executionStartedAt?: Date

  /**
   * Settled here, but never confirmed on Transacto.
   *
   * Set when `orders_execute` answered 108: the payer's money is in the jar and
   * the order is EXECUTED locally, while upstream it is still open and only a
   * human — or the retry cron — can close it. Kept separate from
   * {@link executionReason}, which records *why* the money was credited and is
   * still an honest FULL_MATCH or FUZZY_MATCH; this records what did not happen
   * afterwards.
   *
   * `false` for every order that never had the problem, so the retry query is a
   * plain equality and historical rows are untouched.
   */
  @Prop({ type: Boolean, default: false })
  awaitingUpstreamConfirmation: boolean

  /**
   * How many times the retry has asked Transacto to confirm it.
   *
   * Bounded so an order the trader never intends to confirm stops costing a
   * request forever; the alert stays up regardless, because the work is still
   * outstanding whether or not we are still asking.
   */
  @Prop({ type: Number, default: 0 })
  upstreamConfirmationAttempts: number

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const OrderSchema = SchemaFactory.createForClass(Order)
