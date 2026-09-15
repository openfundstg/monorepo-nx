import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { MONGO_URL } from 'src/shared/constants'
import { MigrationsModule } from './migrations.module'

/**
 * The whole application, for the length of one migration: a database
 * connection and the migrations themselves.
 *
 * Deliberately **not** `AppModule`. Booting that would start the BullMQ
 * schedulers, the Redis connections, the socket gateway, the reconcilers and
 * the pollers — every one of which would begin doing real work to the data the
 * migration is halfway through rewriting. It is also the difference between a
 * CLI that starts in a second and one that starts in twenty.
 *
 * The cost is that this list has to gain a module when a migration needs a
 * collection nothing has needed before, which is a good moment to notice how
 * much a migration is reaching for.
 */
@Module({
  imports: [
    MongooseModule.forRoot(MONGO_URL, {
      // A server waits for a database that is coming back; a command-line tool
      // must say what is wrong and give the terminal back. With the defaults —
      // three retries over a thirty-second selection timeout — a typo in
      // `DB_URL` hangs for a minute and a half before admitting anything.
      serverSelectionTimeoutMS: 5_000,
      retryAttempts: 0
    }),
    MigrationsModule
  ]
})
export class MigrationCliModule {}
