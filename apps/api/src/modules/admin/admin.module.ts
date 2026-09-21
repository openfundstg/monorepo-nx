import { Module } from '@nestjs/common'

// Repository modules — schemas and DB services live there, never here
import { AdminDbModule } from 'src/modules/repositories/admin-db'
import { TmaUserDbModule } from 'src/modules/repositories/tma-user-db/tma-user-db.module'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { TmaDepositDbModule } from 'src/modules/repositories/tma-deposit-db/tma-deposit-db.module'
import { TmaFiatDepositDbModule } from 'src/modules/repositories/tma-fiat-deposit-db/tma-fiat-deposit-db.module'
import { TmaFiatDepositWatchDbModule } from 'src/modules/repositories/tma-fiat-deposit-watch-db/tma-fiat-deposit-watch-db.module'
import { TmaReferralDbModule } from 'src/modules/repositories/tma-referral-db/tma-referral-db.module'
import { TerminalDbModule } from 'src/modules/repositories/terminal-db'
import { TerminalHistoryDbModule } from 'src/modules/repositories/terminal-history-db'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { AlertsDbModule } from 'src/modules/repositories/alerts-db'
import { SafeBoxDbModule } from 'src/modules/repositories/safe-box-db/safe-box-db.module'
import { SupportDbModule } from 'src/modules/repositories/support-db'
import { AdminFeedDbModule } from 'src/modules/repositories/admin-feed-db'

// Domain modules whose settlement paths this one reuses rather than reimplements
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { AuthModule } from 'src/modules/auth'
import { TerminalModule } from 'src/modules/terminal'
import { TelegramMiniAppModule } from 'src/modules/telegram-mini-app'

import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import {
  AdminAlertsController,
  AdminAuditController,
  AdminAuthController,
  AdminDepositsController,
  AdminFiatDepositWatchesController,
  AdminDocumentsController,
  AdminOrdersController,
  AdminOverviewController,
  AdminReferralsController,
  AdminSafeBoxController,
  AdminSalesController,
  AdminSupportController,
  AdminTerminalsController,
  AdminTradersController,
  AdminUsersController
} from 'src/modules/admin/controllers'
import {
  AdminAlertsService,
  AdminAuditService,
  AdminBroadcastService,
  AdminDepositsService,
  AdminFiatDepositWatchesService,
  AdminDocumentsService,
  AdminFiatDepositsService,
  AdminLoginService,
  AdminOverviewService,
  AdminSalesService,
  AdminSupportService,
  AdminTerminalsService,
  AdminTradersService,
  AdminUsersService
} from 'src/modules/admin/services'

/**
 * The admin panel's backend.
 *
 * It reads across almost every collection in the system, which makes its import
 * list long and is the honest shape of what it is — one operator's view of
 * everything. Two rules keep that from turning into a second implementation of
 * the product:
 *
 * 1. **It owns exactly one collection**, the audit log in `AdminDbModule`.
 *    Everything else it reads through the `-db` service that already owns it.
 * 2. **Every write delegates.** Blocking a sale, refunding a stake,
 *    standing a terminal down — each goes through the service that already does
 *    it for the product, because those paths freeze balances, retire terminals
 *    upstream, pay referrers and push to the user's own screen. What this module
 *    adds is the operator's reason, the audit row, and the fan-out to other open
 *    panels.
 *
 * The one exception is a manual balance correction, which has no product
 * equivalent by definition — and is therefore the most heavily audited thing
 * here.
 *
 * `TelegramMiniAppModule` is imported for its three settlement services. That
 * edge points admin → mini app and never back: the Mini App announces movements
 * on a neutral event channel (`TMA_DOMAIN_EVENT`) that this module subscribes
 * to, so nothing over there knows a panel exists.
 */
@Module({
  imports: [
    AuthModule,
    AdminDbModule,
    TmaUserDbModule,
    TmaSaleDbModule,
    TmaDepositDbModule,
    TmaFiatDepositDbModule,
    TmaFiatDepositWatchDbModule,
    TmaReferralDbModule,
    TerminalDbModule,
    TerminalHistoryDbModule,
    OrderDbModule,
    TraderDbModule,
    AlertsDbModule,
    // Resolving an alert goes through the same service the trader's own
    // acknowledgement uses, so their extension still hears about it.
    AlertsModule,
    SafeBoxDbModule,
    SupportDbModule,
    // The two reads that span collections: the deposits book and the archive.
    // Read-only by construction — see the module's own note.
    AdminFeedDbModule,
    // Enabling and disabling a terminal, with the upstream ordering each
    // direction requires.
    TerminalModule,
    // Cancel, block and complete — the same paths the user's own buttons take.
    TelegramMiniAppModule
  ],
  controllers: [
    AdminAuthController,
    AdminOverviewController,
    AdminUsersController,
    AdminReferralsController,
    AdminSalesController,
    AdminDepositsController,
      // Card-sale disputes, addressed by Transacto's order number — the only
    // identifier an operator arrives from their panel holding.
    AdminDocumentsController,
    AdminFiatDepositWatchesController,
    AdminTerminalsController,
    AdminOrdersController,
    AdminTradersController,
    AdminAlertsController,
    AdminSafeBoxController,
    AdminSupportController,
    AdminAuditController
  ],
  providers: [
    AdminGateway,
    AdminAuditService,
    AdminLoginService,
    AdminOverviewService,
    AdminUsersService,
    AdminSalesService,
    AdminDepositsService,
    AdminFiatDepositsService,
    AdminDocumentsService,
    AdminFiatDepositWatchesService,
    AdminTerminalsService,
    AdminTradersService,
    AdminAlertsService,
    AdminSupportService,
    // Not injected by anything — it is a listener, and exists to be constructed
    // so its `@OnEvent` handlers are registered.
    AdminBroadcastService
  ]
})
export class AdminModule {}
