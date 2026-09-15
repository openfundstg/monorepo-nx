import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose'
import { AdminAuditAction, AdminAuditTargetType } from '@transacto/contracts'

export type AdminAuditLogDocument = HydratedDocument<AdminAuditLog>

// Both travel to the panel on every audit row, so contracts owns them.
export { AdminAuditAction, AdminAuditTargetType }

/**
 * One thing an admin did that changed state.
 *
 * Append-only by convention and by shape: there is no update path in the DB
 * service, and nothing in the panel offers one. An audit trail an operator can
 * edit answers no question worth asking.
 *
 * A key plus its parameters, never a rendered sentence — the same rule alerts
 * and sale timelines follow. The panel renders `'AUDIT.' + action` with
 * {@link metadata} as its arguments, so the row reads in whichever language the
 * operator has set and the numbers stay numbers.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'admin_audit_logs',
  versionKey: false
})
export class AdminAuditLog {
  /** The configured `ADMIN_USERNAME` that was logged in. */
  @Prop({ type: String, required: true, index: true })
  actor: string

  @Prop({ type: String, enum: AdminAuditAction, required: true, index: true })
  action: AdminAuditAction

  @Prop({ type: String, enum: AdminAuditTargetType, required: true, index: true })
  targetType: AdminAuditTargetType

  /**
   * Whatever identifies the thing acted on — a Telegram id, an order's
   * `publicId`, a `cardId`, a `traderId`.
   *
   * A string rather than a union of the four, because the column exists to be
   * searched and displayed, not joined on. Storing each kind in its own typed
   * field would mean four sparse columns and a `$or` on every lookup.
   */
  @Prop({ type: String, required: true, index: true })
  targetId: string

  /**
   * Why the operator did it, in their own words.
   *
   * Mandatory on money movements and on blocking somebody, optional on the
   * rest. This is the one field here that is deliberately free text: it records
   * intent, which no enum can.
   */
  @Prop({ type: String, default: null })
  reason: string | null

  /**
   * Everything the rendered line interpolates — amounts, before/after figures,
   * the flags that moved.
   *
   * Every value a translation needs must be here. A figure that only ever
   * existed inside a log line is unreachable to the panel.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata: Record<string, unknown> | null

  /**
   * The address the request came from, as Express reports it.
   *
   * Behind the production reverse proxy this is the proxy unless `trust proxy`
   * is enabled, which it is not — so treat it as a hint, not evidence.
   */
  @Prop({ type: String, default: null })
  ip: string | null

  createdAt: Date
}

export const AdminAuditLogSchema = SchemaFactory.createForClass(AdminAuditLog)

/** The panel's default view: everything, newest first. */
AdminAuditLogSchema.index({ createdAt: -1 })
