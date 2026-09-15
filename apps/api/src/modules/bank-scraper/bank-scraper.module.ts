import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { TransactoModule } from 'src/modules/transacto'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { TerminalModule } from 'src/modules/terminal/terminal.module'
import { TerminalHistoryModule } from 'src/modules/terminal-history/terminal-history.module'
import { TraderDbModule } from 'src/modules/repositories/trader-db/trader-db.module'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import { SCRAPER_STRATEGIES } from 'src/modules/bank-scraper/constants'
import type { ScraperStrategy } from 'src/modules/bank-scraper/interfaces'
import {
  MonoScraperStrategy,
  NovaPayScraperStrategy,
  PrivatScraperStrategy,
  PumbScraperStrategy
} from 'src/modules/bank-scraper/strategies'
import {
  BalanceProcessorService,
  BankScraperApiService,
  BankScraperService,
  BankScraperWorkerService,
  OrderMatcherService,
  ScraperExecutionService,
  ScraperWatchdogService,
  SubsetSumMatcherService,
  TerminalBalanceOrchestratorService,
  TerminalErrorHandlerService,
  TerminalOrdersBroadcastListener,
  TerminalStateCacheService
} from 'src/modules/bank-scraper/services'

@Module({
  imports: [
    BullModule.registerQueue({ name: BANK_SCRAPER_QUEUE_NAME }),
    TransactoModule,
    OrderDbModule,
    TmaSaleDbModule,
    TerminalHistoryModule,
    TraderDbModule,
    AlertsModule,
    TerminalModule
  ],
  providers: [
    BankScraperService,
    BankScraperApiService,
    BankScraperWorkerService,
    ScraperExecutionService,
    ScraperWatchdogService,
    BalanceProcessorService,
    OrderMatcherService,
    SubsetSumMatcherService,
    TerminalStateCacheService,
    TerminalErrorHandlerService,
    TerminalBalanceOrchestratorService,
    TerminalOrdersBroadcastListener,

    MonoScraperStrategy,
    NovaPayScraperStrategy,
    PrivatScraperStrategy,
    PumbScraperStrategy,

    // The single list of supported banks. BankScraperService keys it by
    // `provider`, so a new bank is a new strategy plus one line here.
    {
      provide: SCRAPER_STRATEGIES,
      inject: [
        MonoScraperStrategy,
        NovaPayScraperStrategy,
        PrivatScraperStrategy,
        PumbScraperStrategy
      ],
      useFactory: (...strategies: ScraperStrategy[]) => strategies
    }
  ],
  exports: [
    BankScraperApiService,
    BankScraperService,
    BankScraperWorkerService,
    TerminalStateCacheService,
    TerminalBalanceOrchestratorService
  ]
})
export class BankScraperModule {}
