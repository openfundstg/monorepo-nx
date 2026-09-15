import { Module } from '@nestjs/common'
import { TerminalHistoryDbModule } from 'src/modules/repositories/terminal-history-db'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { TerminalModule } from 'src/modules/terminal'
import { TerminalHistoryService } from './services/terminal-history.service'

@Module({
  imports: [TerminalHistoryDbModule, OrderDbModule, TerminalModule],
  providers: [TerminalHistoryService],
  exports: [TerminalHistoryService, TerminalHistoryDbModule]
})
export class TerminalHistoryModule {}
