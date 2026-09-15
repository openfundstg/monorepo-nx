import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  MIGRATION_LOCK_ID,
  Migration,
  MigrationDocument,
  MigrationLock,
  MigrationLockDocument
} from 'src/modules/repositories/migration-db/schemas'
import { isDuplicateKeyOn } from 'src/shared/utils'

@Injectable()
export class MigrationDbService {
  constructor(
    @InjectModel(Migration.name)
    private readonly migrationModel: Model<MigrationDocument>,
    @InjectModel(MigrationLock.name)
    private readonly lockModel: Model<MigrationLockDocument>
  ) {}

  /** Every migration that has already run, oldest first. */
  async findApplied(): Promise<Migration[]> {
    return this.migrationModel.find().sort({ appliedAt: 1 }).lean()
  }

  async record(entry: {
    name: string
    appliedAt: Date
    durationMs: number
    summary: string
  }): Promise<void> {
    await this.migrationModel.create(entry)
  }

  /** Forgets one, so it is pending again. Used by `down`. */
  async forget(name: string): Promise<void> {
    await this.migrationModel.deleteOne({ name })
  }

  /**
   * Takes the run lock, or reports who holds it.
   *
   * `null` on success and the holder's description on failure, rather than a
   * boolean: an operator staring at a refusal needs to know whether the lock is
   * a run in progress on another shell or the corpse of one that died last
   * Tuesday, and only the holder line says which.
   */
  async acquireLock(holder: string): Promise<string | null> {
    try {
      await this.lockModel.create({ _id: MIGRATION_LOCK_ID, startedAt: new Date(), holder })

      return null
    } catch (error: unknown) {
      if (!isDuplicateKeyOn(error, '_id')) throw error

      const held = await this.lockModel.findById(MIGRATION_LOCK_ID).lean()

      return held === null
        ? // Released between the failed insert and this read: the next attempt
          // would succeed, and saying "held by nobody" is better than a lie.
          'a run that has just finished'
        : `${held.holder} since ${held.startedAt.toISOString()}`
    }
  }

  async releaseLock(): Promise<void> {
    await this.lockModel.deleteOne({ _id: MIGRATION_LOCK_ID })
  }

  /** The holder, for `migrate status`. */
  async findLock(): Promise<MigrationLock | null> {
    return this.lockModel.findById(MIGRATION_LOCK_ID).lean()
  }
}
