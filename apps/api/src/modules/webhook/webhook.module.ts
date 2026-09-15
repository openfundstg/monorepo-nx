import { Module } from '@nestjs/common'
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { OrderPollingModule } from 'src/modules/order-polling'
import { WebhookController } from 'src/modules/webhook/controllers/webhook.controller'
import { WebhookSignatureGuard } from 'src/modules/webhook/guards/webhook-signature.guard'

@Module({
  imports: [TraderDbModule, OrderPollingModule],
  controllers: [WebhookController],
  providers: [WebhookSignatureGuard]
})
export class WebhookModule {}
