import { Module } from '@nestjs/common'
import { AlertsDbModule } from 'src/modules/repositories/alerts-db'
import { AlertsService } from './services/alerts.service'

/**
 * Domain module. The Alert schema and AlertDbService live in
 * repositories/alerts-db; the TERMINAL_ALERT_TRIGGERED / RESOLVED emission that
 * used to sit in a schema hook now lives in AlertDbService, on the two write
 * paths that actually triggered it.
 */
@Module({
  imports: [AlertsDbModule],
  providers: [AlertsService],
  exports: [AlertsService, AlertsDbModule]
})
export class AlertsModule {}
