import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { hostname } from 'os'
import { MigrationDbService } from 'src/modules/repositories/migration-db/services'
import { MIGRATIONS } from 'src/migrations/migrations.const'
import type { Migration } from 'src/migrations/interfaces'
import { describeError } from 'src/shared/utils'

/** One row of `migrate status`. */
export interface MigrationStatus {
  name: string
  appliedAt: Date | null
  reversible: boolean
}

/**
 * Runs the migrations, records what ran, and refuses to run two at once.
 *
 * Deliberately not part of any request path and not scheduled: migrations are
 * started by a person, on purpose, at a moment they have chosen. The one thing
 * this does inside the running API is complain on boot when something is
 * pending — the failure it exists to prevent is not a bad migration but a
 * forgotten one, which shows up as a feature that quietly has no data.
 */
@Injectable()
export class MigrationRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationRunnerService.name)

  constructor(
    private readonly db: MigrationDbService,
    @Inject(MIGRATIONS) private readonly migrations: readonly Migration[]
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.pending().catch((error: unknown) => {
      // Never worth failing a boot over: this is a courtesy, and the database
      // being unreachable will announce itself far more loudly elsewhere.
      this.logger.warn(`Could not check for pending migrations: ${describeError(error)}`)
      return []
    })

    if (pending.length > 0)
      this.logger.warn(
        `${pending.length} migration(s) pending: ${pending.map(({ name }) => name).join(', ')}. ` +
          'Run `node main.js migrate up`.'
      )
  }

  /** Every known migration and whether it has run. */
  async status(): Promise<MigrationStatus[]> {
    const applied = new Map(
      (await this.db.findApplied()).map((row) => [row.name, row.appliedAt] as const)
    )

    return this.migrations.map((migration) => ({
      name: migration.name,
      appliedAt: applied.get(migration.name) ?? null,
      reversible: migration.down !== undefined
    }))
  }

  /** Who holds the run lock, if anybody. */
  async lockHolder(): Promise<string | null> {
    const lock = await this.db.findLock()

    return lock === null ? null : `${lock.holder} since ${lock.startedAt.toISOString()}`
  }

  async releaseLock(): Promise<void> {
    await this.db.releaseLock()
  }

  /**
   * Runs everything pending, oldest first, and stops at the first failure.
   *
   * Stopping matters: migrations are ordered because later ones assume earlier
   * ones ran. Carrying on past a failure would apply them out of order against
   * data that is not what they expect.
   */
  async up(): Promise<void> {
    await this.locked(async () => {
      const pending = await this.pending()

      if (pending.length === 0) {
        this.logger.log('Nothing to migrate.')
        return
      }

      for (const migration of pending) await this.apply(migration)

      this.logger.log(`Applied ${pending.length} migration(s).`)
    })
  }

  /**
   * Reverses one — the last applied by default.
   *
   * Named explicitly or not at all: reversing "the last one" is the case that
   * comes up, and reversing an arbitrary earlier one is almost always a mistake
   * that a name in the command makes deliberate.
   */
  async down(name?: string): Promise<void> {
    await this.locked(async () => {
      const applied = await this.db.findApplied()
      const target = name ?? applied.at(-1)?.name

      if (target === undefined) {
        this.logger.log('Nothing has been applied.')
        return
      }

      const migration = this.migrations.find((candidate) => candidate.name === target)

      if (migration === undefined) throw new Error(`No migration named ${target}`)
      if (!applied.some((row) => row.name === target))
        throw new Error(`${target} has not been applied`)
      if (migration.down === undefined) throw new Error(`${target} cannot be reversed`)

      const startedAt = Date.now()
      const summary = await migration.down()

      // Forgotten only after the work is undone: the reverse of the ordering
      // `apply` uses, and for the same reason — the record must never claim
      // something the data does not.
      await this.db.forget(target)
      this.logger.log(`↓ ${target} — ${summary} (${Date.now() - startedAt} ms)`)
    })
  }

  private async pending(): Promise<Migration[]> {
    const applied = new Set((await this.db.findApplied()).map(({ name }) => name))

    return this.migrations.filter((migration) => !applied.has(migration.name))
  }

  private async apply(migration: Migration): Promise<void> {
    const startedAt = Date.now()
    this.logger.log(`↑ ${migration.name}…`)

    const summary = await migration.up()
    const durationMs = Date.now() - startedAt

    // Recorded after the work, so a crash mid-migration leaves it pending
    // rather than leaving it marked done and half-applied. The cost of that
    // ordering is a migration that finished and failed to record, which runs
    // again — which is why every one of them has to be idempotent.
    await this.db.record({ name: migration.name, appliedAt: new Date(), durationMs, summary })

    this.logger.log(`✓ ${migration.name} — ${summary} (${durationMs} ms)`)
  }

  /**
   * Holds the lock for the length of the work.
   *
   * Released in `finally`, so an ordinary failure does not leave one standing.
   * A process killed outright still does — that is the case `migrate unlock`
   * exists for, and it is deliberately a decision rather than a timeout.
   */
  private async locked(work: () => Promise<void>): Promise<void> {
    const holder = await this.db.acquireLock(`${hostname()}:${process.pid}`)

    if (holder !== null)
      throw new Error(
        `Migrations are locked by ${holder}. If that run is dead, release it with ` +
          '`node main.js migrate unlock`.'
      )

    try {
      await work()
    } finally {
      await this.db.releaseLock()
    }
  }
}
