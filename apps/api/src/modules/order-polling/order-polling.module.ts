import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { TerminalModule } from 'src/modules/terminal'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { TransactoModule } from 'src/modules/transacto'
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import { OrderPollingService } from 'src/modules/order-polling/services/order-polling.service'
import { OrderSyncService } from 'src/modules/order-polling/services/order-sync.service'

import { TerminalHistoryModule } from 'src/modules/terminal-history/terminal-history.module'
import { BankScraperModule } from 'src/modules/bank-scraper'

@Module({
  imports: [
    BullModule.registerQueue({ name: BANK_SCRAPER_QUEUE_NAME }),
    TerminalModule,
    OrderDbModule,
    TraderDbModule,
    TransactoModule,
    TerminalHistoryModule,
    BankScraperModule,
    AlertsModule
  ],
  providers: [OrderPollingService, OrderSyncService],
  exports: [OrderPollingService]
})
export class OrderPollingModule {}
