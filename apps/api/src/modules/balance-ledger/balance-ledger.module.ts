import { Module } from '@nestjs/common'
import { TmaBalanceEntryDbModule } from 'src/modules/repositories/tma-balance-entry-db/tma-balance-entry-db.module'
import { TmaUserDbModule } from 'src/modules/repositories/tma-user-db/tma-user-db.module'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'

/**
 * The one door onto a user's balance, as a module of its own.
 *
 * It began inside `TelegramMiniAppModule`, where its callers are. A second
 * context then needed it — the migration CLI, which repairs stakes frozen
 * against orders that were never written — and the alternative was importing
 * the whole Mini App module into a command-line tool, which would start the
 * BullMQ schedulers, the socket gateway and the reconcilers to move one
 * balance.
 *
 * Deliberately small: two repositories and one service. Anything that moves
 * money imports this rather than reaching for `TmaUserDbService` — see
 * `apps/api/CLAUDE.md`, *Money has one door*.
 */
@Module({
  imports: [TmaUserDbModule, TmaBalanceEntryDbModule],
  providers: [BalanceLedgerService],
  exports: [BalanceLedgerService]
})
export class BalanceLedgerModule {}
