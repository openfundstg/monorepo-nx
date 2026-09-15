import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type MigrationLockDocument = HydratedDocument<MigrationLock>

/** The single document id the lock lives under. There is only ever one. */
export const MIGRATION_LOCK_ID = 'runner'

/**
 * Held for the length of a migration run.
 *
 * A document rather than an advisory lock, because the only place two runners
 * can see each other is the database they are both migrating. `_id` is a fixed
 * string, so the insert either wins or fails with a duplicate key — there is no
 * read-then-write to race.
 *
 * It is not released by a timeout on purpose. A run that died halfway through
 * leaves the lock standing, and that is the correct state to find: somebody has
 * to look at what it managed to do before the next one starts. `migrate unlock`
 * is that decision, taken by a person.
 */
@Schema({ collection: 'migration_locks', versionKey: false })
export class MigrationLock {
  @Prop({ type: String, required: true })
  _id: string

  @Prop({ type: Date, required: true })
  startedAt: Date

  /** Whoever took it — the container's hostname and pid, for the message. */
  @Prop({ type: String, required: true })
  holder: string
}

export const MigrationLockSchema = SchemaFactory.createForClass(MigrationLock)
