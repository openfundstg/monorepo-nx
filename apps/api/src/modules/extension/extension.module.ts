import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ExtensionController } from 'src/modules/extension/controllers/extension.controller'
import { ExtensionGateway } from 'src/modules/extension/gateways/extension.gateway'
import { ExtensionWsAuthService } from 'src/modules/extension/services/extension-ws-auth.service'
import { ExtensionWsEmitterService } from 'src/modules/extension/services/extension-ws-emitter.service'
import { TraderDbModule } from 'src/modules/repositories/trader-db/trader-db.module'
import { TransactoModule } from 'src/modules/transacto/transacto.module'
import { OrderDbModule } from 'src/modules/repositories/order-db/order-db.module'
import { TerminalModule } from 'src/modules/terminal/terminal.module'
import { RedisModule } from 'src/shared/redis'
import { BANK_SCRAPER_QUEUE_NAME } from 'src/shared/constants'
import { BankScraperModule } from 'src/modules/bank-scraper'

import { TerminalHistoryModule } from 'src/modules/terminal-history/terminal-history.module'
import { SafeBoxDbModule } from 'src/modules/repositories/safe-box-db/safe-box-db.module'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { ExtensionAuthService } from 'src/modules/extension/services/extension-auth.service'
import { ExtensionDashboardService } from 'src/modules/extension/services/extension-dashboard.service'
import { ExtensionAlertsActionService } from 'src/modules/extension/services/extension-alerts-action.service'
import { ExtensionTerminalSearchService } from 'src/modules/extension/services/extension-terminal-search.service'

@Module({
  imports: [
    AlertsModule,
    BullModule.registerQueue({
      name: BANK_SCRAPER_QUEUE_NAME
    }),
    TraderDbModule,
    TransactoModule,
    OrderDbModule,
    TerminalHistoryModule,
    SafeBoxDbModule,
    TmaSaleDbModule,
    TerminalModule,
    BankScraperModule,
    RedisModule
  ],
  controllers: [ExtensionController],
  providers: [
    ExtensionGateway,
    ExtensionWsAuthService,
    ExtensionWsEmitterService,
    ExtensionAuthService,
    ExtensionDashboardService,
    ExtensionAlertsActionService,
    ExtensionTerminalSearchService
  ]
})
export class ExtensionModule {}
