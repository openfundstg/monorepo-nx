import { Module } from '@nestjs/common'
import { TransactoPanelModule } from 'src/modules/transacto/transacto-panel.module'
import { ExchangeRateService } from './services'

/**
 * The one USDT→UAH price the product quotes.
 *
 * Lifted out of `TelegramMiniAppModule`, which used to own it, once a second
 * domain needed the same number: the support bot prints the rate on its balance
 * card. The alternative was for `SupportModule` to import the whole Mini App
 * domain — every controller, gateway, facade and worker — to reach one method,
 * or for the bot to fetch a price of its own, which is the exact drift the
 * service's own doc comment exists to prevent.
 */
@Module({
  imports: [TransactoPanelModule],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService]
})
export class ExchangeRateModule {}
