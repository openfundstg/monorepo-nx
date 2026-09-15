import { Module } from '@nestjs/common'
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { TransactoModule } from 'src/modules/transacto'
import { TerminalDbModule } from 'src/modules/repositories/terminal-db'
import { AlertsModule } from 'src/modules/alerts/alerts.module'
import { TerminalsSyncService } from 'src/modules/terminal/services/terminals-sync.service'
import { TerminalDeactivationService } from 'src/modules/terminal/services/terminal-deactivation.service'
import { TerminalActivationService } from 'src/modules/terminal/services/terminal-activation.service'
import { TerminalUrlResolverService } from 'src/modules/terminal/services/terminal-url-resolver.service'
import { TerminalBroadcastService } from 'src/modules/terminal/services/terminal-broadcast.service'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'

/**
 * Domain module. The Terminal schema and TerminalDbService now live in
 * repositories/terminal-db.
 *
 * The schema previously carried post('save') / post('findOneAndUpdate') hooks
 * emitting TERMINAL_ENABLED and TERMINAL_DISABLED. Those hooks were dead code:
 * every write path goes through updateOne, upsert or bulkWrite, and Mongoose
 * fires neither hook for any of them. Restoring the events is tracked in
 * REFACTORING.md rather than switched on here — TERMINAL_ENABLED carries only
 * { terminalId, cardId }, which is not enough for the extension to render a
 * terminal, so the payload has to be widened first.
 */
@Module({
  imports: [
    TerminalDbModule,
    TraderDbModule,
    TransactoModule,
    AlertsModule,
    OrderDbModule,
    TmaSaleDbModule
  ],
  providers: [
    TerminalsSyncService,
    TerminalDeactivationService,
    TerminalActivationService,
    TerminalUrlResolverService,
    TerminalBroadcastService
  ],
  exports: [
    TerminalDbModule,
    TerminalDeactivationService,
    TerminalActivationService,
    TerminalUrlResolverService,
    TerminalBroadcastService
  ]
})
export class TerminalModule {}
