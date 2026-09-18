import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { HttpModule } from '@nestjs/axios'
import environments from 'src/environments'
import { SUPPORT_ALBUM_QUEUE } from 'src/shared/constants'
import { ExchangeRateModule } from 'src/modules/exchange-rate'
import { SupportDbModule } from 'src/modules/repositories/support-db'
import { TmaUserDbModule } from 'src/modules/repositories/tma-user-db/tma-user-db.module'
import { TmaFiatDepositWatchDbModule } from 'src/modules/repositories/tma-fiat-deposit-watch-db/tma-fiat-deposit-watch-db.module'
import { TmaSaleDbModule } from 'src/modules/repositories/tma-sale-db/tma-sale-db.module'
import { TelegramMiniAppModule } from 'src/modules/telegram-mini-app'
import {
  SupportConfig,
  TELEGRAM_API_BASE_URL
} from 'src/modules/support/constants/support.constants'
import { resolveSupportBotToken } from 'src/modules/support/utils'
import { SupportWebhookController } from 'src/modules/support/controllers/support-webhook.controller'
import { TelegramWebhookGuard } from 'src/modules/support/guards/telegram-webhook.guard'
import { SupportAlbumWorker } from 'src/modules/support/workers/support-album.worker'
import {
  SupportAlbumService,
  SupportAlertsListener,
  SupportCardSaleService,
  SupportConfigService,
  SupportFiatWatchService,
  SupportMenuService,
  SupportRelayService,
  SupportService,
  SupportTopicService,
  SupportUserService,
  SupportWebhookRegistrarService,
  TelegramBotApiService
} from 'src/modules/support/services'

@Module({
  imports: [
    SupportDbModule,
    // Albums are gathered in Redis and sent from a delayed job — see
    // `SupportAlbumService` for why this cannot happen in the request.
    BullModule.registerQueue({ name: SUPPORT_ALBUM_QUEUE }),
    // The *Balance* key reads the Mini App's account and quotes the live price.
    // Support owns neither, so it asks whoever does rather than keeping a copy —
    // a second rate source would quote a different number from the one every
    // deposit and order is priced at.
    TmaUserDbModule,
    // Standing requests for an amount. Read to answer an unsubscribe key, and
    // written to retire a request the bot has just answered — which only the
    // sender can know it did. The Mini App owns the matching and must not know
    // this module exists, so what arrives from there is an event, not a call.
    TmaFiatDepositWatchDbModule,
    // A card sale's orders, which this bot's inline keys answer.
    //
    // The one place the arrow points this way, and it points only this way:
    // the Mini App never imports this module, and still learns that the bot
    // exists only through a neutral domain event. What comes back the other
    // way is a call, because a key press has to be answered now and its
    // refusals have to reach the person who pressed it.
    TelegramMiniAppModule,
    // Resolving the sale behind a pressed key. The payload carries only the
    // order id, deliberately — a `callback_data` a client can edit must not
    // be able to name somebody else's sale.
    TmaSaleDbModule,
    ExchangeRateModule,
    // The bot token lives in the base URL because that is where Telegram wants
    // it — `/bot<token>/<method>`. Consequence: the request path is a
    // credential, so nothing in this module logs a raw axios error. See
    // `describeTelegramFailure`.
    //
    // `TELEGRAM_SUPPORT_BOT_TOKEN` when support runs on a bot of its own,
    // `TELEGRAM_BOT_TOKEN` when it shares the Mini App's. The two must never be
    // conflated: `TmaAuthService` derives its `initData` key from the latter,
    // so a support bot's token in that variable logs every user out.
    HttpModule.register({
      timeout: SupportConfig.API_TIMEOUT_MS,
      baseURL: `${TELEGRAM_API_BASE_URL}/bot${resolveSupportBotToken(
        environments.TELEGRAM_SUPPORT_BOT_TOKEN,
        environments.TELEGRAM_BOT_TOKEN
      )}`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })
  ],
  controllers: [SupportWebhookController],
  providers: [
    // Listens on the internal event bus; nothing injects it.
    SupportAlertsListener,
    SupportConfigService,
    TelegramBotApiService,
    SupportAlbumService,
    SupportUserService,
    SupportFiatWatchService,
    SupportCardSaleService,
    SupportMenuService,
    SupportTopicService,
    SupportRelayService,
    SupportService,
    SupportWebhookRegistrarService,
    SupportAlbumWorker,
    TelegramWebhookGuard
  ],
  exports: [SupportService]
})
export class SupportModule {}
