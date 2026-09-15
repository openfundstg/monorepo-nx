import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type MigrationDocument = HydratedDocument<Migration>

/**
 * One migration that has run, and is therefore never to run again.
 *
 * The whole state of the system: a migration is pending if this collection has
 * no row naming it. There is deliberately no status field and no "failed" row —
 * a migration either finished and is recorded, or it did not and is not, so a
 * crashed run leaves the same state as one that never started. That is what
 * makes re-running the safe thing to do rather than the thing to be careful
 * about, and it is why every migration has to be written to survive it.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'migrations', versionKey: false })
export class Migration {
  /**
   * The migration's own name — `0001-backfill-balance-entries`.
   *
   * Unique, because this is the record that stops a second run. Renaming a
   * migration that has already run anywhere is therefore the one thing never to
   * do: the new name has no row, so it runs again.
   */
  @Prop({ type: String, required: true, unique: true })
  name: string

  @Prop({ type: Date, required: true })
  appliedAt: Date

  /** How long it took, so a slow one is a known quantity next time. */
  @Prop({ type: Number, required: true })
  durationMs: number

  /** What it did, in the migration's own words — the line the runner logged. */
  @Prop({ type: String, default: null })
  summary: string | null

  createdAt: Date
}

export const MigrationSchema = SchemaFactory.createForClass(Migration)
