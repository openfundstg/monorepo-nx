import { Module } from '@nestjs/common'
import { MigrationDbModule } from 'src/modules/repositories/migration-db/migration-db.module'
import { TmaBalanceEntryDbModule } from 'src/modules/repositories/tma-balance-entry-db/tma-balance-entry-db.module'
import { TmaDepositDbModule } from 'src/modules/repositories/tma-deposit-db/tma-deposit-db.module'
import { TmaFiatDepositDbModule } from 'src/modules/repositories/tma-fiat-deposit-db/tma-fiat-deposit-db.module'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { TmaUserDbModule } from 'src/modules/repositories/tma-user-db/tma-user-db.module'
import { AdminDbModule } from 'src/modules/repositories/admin-db/admin-db.module'
import { TmaReferralDbModule } from 'src/modules/repositories/tma-referral-db/tma-referral-db.module'
import { TerminalHistoryDbModule } from 'src/modules/repositories/terminal-history-db/terminal-history-db.module'
import { BalanceLedgerModule } from 'src/modules/balance-ledger/balance-ledger.module'
import { MIGRATIONS, MIGRATION_CLASSES } from './migrations.const'
import { MigrationRunnerService } from './services'
import type { Migration } from './interfaces'

/**
 * The migrations and the thing that runs them.
 *
 * Imported by `AppModule` so the running API can say what is pending, and
 * bootstrapped on its own by the CLI — which is why it imports the repository
 * modules it needs rather than assuming somebody else already has. Nothing here
 * touches Mongoose directly: a migration reads and writes through the same DB
 * services the product does, so a collection has one place that knows its
 * shape whether the writer is a request or a backfill.
 */
@Module({
  imports: [
    MigrationDbModule,
    TmaBalanceEntryDbModule,
    TmaDepositDbModule,
    TmaFiatDepositDbModule,
    TmaSaleDbModule,
    TmaUserDbModule,
    AdminDbModule,
    TmaReferralDbModule,
    TerminalHistoryDbModule,
    // `0002` hands money back, and it goes through the same door as every other
    // movement rather than reaching for the repository underneath it.
    BalanceLedgerModule
  ],
  providers: [
    ...MIGRATION_CLASSES,
    {
      provide: MIGRATIONS,
      // Resolved as a list so the runner takes them in the order this file
      // states, rather than in whatever order Nest happens to instantiate.
      useFactory: (...migrations: Migration[]) => migrations,
      inject: [...MIGRATION_CLASSES]
    },
    MigrationRunnerService
  ],
  exports: [MigrationRunnerService]
})
export class MigrationsModule {}
