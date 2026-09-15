import { Module, OnModuleInit } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { HttpModule } from '@nestjs/axios'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

// Shared
import { TMA_DEPOSIT_EXPIRY_QUEUE, BLOCKCHAIN_VERIFICATION_STRATEGY } from 'src/shared/constants'

// Repository modules — schemas and DB services live here, never in this module
import { TmaUserDbModule } from 'src/modules/repositories/tma-user-db/tma-user-db.module'
import { TmaDepositDbModule } from 'src/modules/repositories/tma-deposit-db/tma-deposit-db.module'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { TmaFiatDepositDbModule } from 'src/modules/repositories/tma-fiat-deposit-db/tma-fiat-deposit-db.module'
import { TmaFiatDepositWatchDbModule } from 'src/modules/repositories/tma-fiat-deposit-watch-db/tma-fiat-deposit-watch-db.module'
import { TmaBalanceEntryDbModule } from 'src/modules/repositories/tma-balance-entry-db/tma-balance-entry-db.module'
import { BalanceLedgerModule } from 'src/modules/balance-ledger/balance-ledger.module'
import { TmaReferralDbModule } from 'src/modules/repositories/tma-referral-db/tma-referral-db.module'
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { OrderDbModule } from 'src/modules/repositories/order-db'

// Adapters
import { TronTrc20Adapter } from './adapters/tron-trc20.adapter'

// Services
import { DepositFacadeService } from './services/deposit-facade.service'
import { SaleFacadeService } from './services/sale-facade.service'
import { SaleProgressService } from './services/sale-progress.service'
import { SaleProgressListener } from './services/sale-progress.listener'
import { TmaServiceTraderService } from './services/tma-service-trader.service'
import { TestTransactionService } from './services/test-transaction.service'
import { ReferralService } from './services/referral.service'
import { IncomeAnalyticsService } from './services/income-analytics.service'
import { DropLinkResolverService } from './services/drop-link-resolver.service'
import { SaleTerminalService } from './services/sale-terminal.service'
import { SaleBlockService } from './services/sale-block.service'
import { SaleComplianceService } from './services/sale-compliance.service'
import { SaleReconcileService } from 'src/modules/telegram-mini-app/services/sale-reconcile.service'
import { SaleClosingService } from 'src/modules/telegram-mini-app/services/sale-closing.service'
import { SaleCancelService } from './services/sale-cancel.service'
import { SaleReviewService } from './services/sale-review.service'
import { FiatDepositBookService } from './services/fiat-deposit-book.service'
import { FiatDepositCeilingService } from './services/fiat-deposit-ceiling.service'
import { FiatDepositWatchService } from './services/fiat-deposit-watch.service'
import { FiatDepositFacadeService } from './services/fiat-deposit-facade.service'
import { FiatDepositSettlementService } from './services/fiat-deposit-settlement.service'
import { FiatDepositReceiptService } from './services/fiat-deposit-receipt.service'
import { FiatDepositReconcileService } from './services/fiat-deposit-reconcile.service'

// Guard

// Controllers
import { TmaAuthController } from './controllers/tma-auth.controller'
import { TmaDepositController } from './controllers/tma-deposit.controller'
import { TmaRatesController } from './controllers/tma-rates.controller'
import { TmaTrustLevelController } from './controllers/tma-trust-level.controller'
import { TmaSaleController } from './controllers/tma-sale.controller'
import { TmaUserController } from './controllers/tma-user.controller'
import { TmaReferralController } from './controllers/tma-referral.controller'
import { TmaIncomeAnalyticsController } from './controllers/tma-income-analytics.controller'
import { TmaFiatDepositController } from './controllers/tma-fiat-deposit.controller'

// WebSocket
import { TmaGateway } from './gateways/tma.gateway'

// BullMQ Worker
import { DepositExpiryWorker } from './workers/deposit-expiry.worker'

// External modules
import { ExchangeRateModule } from 'src/modules/exchange-rate'
import { TransactoModule } from 'src/modules/transacto'
import { TerminalModule } from 'src/modules/terminal'
import { BankScraperModule } from 'src/modules/bank-scraper'
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { TransactoPanelModule } from 'src/modules/transacto/transacto-panel.module'
import { ReceiptVerificationModule } from 'src/modules/receipt-verification'

@Module({
  imports: [
    AlertsModule,
    TmaUserDbModule,
    TmaDepositDbModule,
    TmaSaleDbModule,
    TmaReferralDbModule,
    TmaFiatDepositDbModule,
    TmaFiatDepositWatchDbModule,
    // The book itself, for the one reader that only reads it: the balance
    // timeline. Everything that *moves* money goes through the door below.
    TmaBalanceEntryDbModule,
    // The one door onto a balance: it moves the money and books why.
    BalanceLedgerModule,
    // Tracked orders: the abuse check reads the last few on a card to spot a
    // terminal nobody can pay into.
    OrderDbModule,
    // The trader row is what makes a Mini App terminal scrapeable at all.
    TraderDbModule,
    HttpModule.register({ timeout: 10_000 }),
    BullModule.registerQueue({ name: TMA_DEPOSIT_EXPIRY_QUEUE }),
    TransactoModule,
    // The one USDT price the product quotes. It lived here until the support
    // bot started printing it too; `TransactoPanelModule` came with it, since
    // `ExchangeRateService` was its only consumer.
    ExchangeRateModule,
    // The panel's payout book, which the fiat top-up settles against. Imported
    // directly rather than through `ExchangeRateModule`, which re-exports
    // nothing: a rate and a book are two different asks of the same session.
    TransactoPanelModule,
    TerminalModule,
    // For PrivatBank's envelope lookup: `DropLinkResolverService` reads the card
    // a drop pays into before an order is created.
    BankScraperModule,
    // Proves a receipt is a real payment, and this payout's, before anything is
    // offered to Transacto. Exports one service; everything under it — the
    // browser that reaches `check.gov.ua`, the per-bank code formats, the
    // signed-PDF unwrapping — is its own business.
    ReceiptVerificationModule
  ],
  controllers: [
    TmaAuthController,
    TmaDepositController,
    TmaRatesController,
    TmaTrustLevelController,
    TmaSaleController,
    TmaUserController,
    TmaReferralController,
    TmaFiatDepositController,
    TmaIncomeAnalyticsController
  ],
  providers: [
    // Strategy / Adapter (DI token → concrete class)
    { provide: BLOCKCHAIN_VERIFICATION_STRATEGY, useClass: TronTrc20Adapter },
    // Business Services
    TestTransactionService,
    TmaServiceTraderService,
    ReferralService,
    IncomeAnalyticsService,
    DropLinkResolverService,
    // Facades
    DepositFacadeService,
    SaleFacadeService,
    // Sale execution progress: the snapshot builder, plus the listener
    // that translates trader-side pipeline events into it.
    SaleProgressService,
    SaleProgressListener,
    // Retiring a terminal — shared by every way an order ends: completed,
    // blocked, or cancelled.
    SaleTerminalService,
    // The two rules an order can break once it is already running.
    SaleBlockService,
    SaleComplianceService,
    // Stopping early, at the user's request, with a partial refund.
    SaleCancelService,
    // The two ways a person can review a blocked order.
    SaleReviewService,
    SaleClosingService,
    SaleReconcileService,
    // Fiat top-ups: the open book a user picks an amount out of, and the
    // reservation path that puts one of its payouts in their name.
    FiatDepositBookService,
    FiatDepositCeilingService,
    FiatDepositWatchService,
    FiatDepositFacadeService,
    // Completing, releasing and reviewing a top-up: one owner, because the
    // reconciler, the Mini App and the admin panel all ask for the same thing.
    FiatDepositSettlementService,
    FiatDepositReceiptService,
    FiatDepositReconcileService,
    // Guard
    // WebSocket
    TmaGateway,
    // BullMQ Worker
    DepositExpiryWorker
  ],
  /**
   * The three ways a running sale can end, exported for the admin
   * panel — which performs the same interventions on an operator's say-so.
   *
   * Exported rather than reimplemented over there because these paths unfreeze
   * stakes, retire terminals upstream, pay referrers and push progress to the
   * user's own screen. A second settlement path for the same money would
   * diverge from this one on the first change to either.
   *
   * Nothing is imported back: the panel learns about movements by subscribing
   * to `TMA_DOMAIN_EVENT`, so this module still has no idea it exists.
   */
  exports: [
    SaleCancelService,
    SaleBlockService,
    SaleFacadeService,
    SaleReviewService,
    // The fiat top-up's settlement path, exported for the admin panel — which
    // performs the same interventions on an operator's say-so.
    FiatDepositSettlementService,
    // Re-exported for the admin panel, which corrects balances on an
    // operator's say-so and must go through the same door.
    BalanceLedgerModule
  ]
})
export class TelegramMiniAppModule implements OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    // Register repeatable job for deposit expiry check (every 60s)
    const queue = this.moduleRef.get<Queue>(getQueueToken(TMA_DEPOSIT_EXPIRY_QUEUE), {
      strict: false
    })
    await queue.upsertJobScheduler(
      'deposit-expiry-scheduler',
      { every: 60_000 },
      { name: 'deposit-expiry' }
    )
  }
}
