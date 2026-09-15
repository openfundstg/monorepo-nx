import { Module, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bullmq'
import { ScheduleModule } from '@nestjs/schedule'
import { EventEmitterModule } from '@nestjs/event-emitter'
// Shared
import { ProxyModule } from 'src/shared/proxy'
import { ScraperWorkerModule } from 'src/shared/scraper-worker'
import { RedisModule } from 'src/shared/redis'
import { AllExceptionsFilter } from 'src/shared/filters'
// Domain & Feature Modules
import { TraderDbModule } from 'src/modules/repositories/trader-db'
import { TransactoModule } from 'src/modules/transacto'
import { TerminalModule } from 'src/modules/terminal'
import { OrderDbModule } from 'src/modules/repositories/order-db'
import { WebhookModule } from 'src/modules/webhook'
import { OrderPollingModule } from 'src/modules/order-polling'
import { BankScraperModule } from 'src/modules/bank-scraper'
import { ExtensionModule } from 'src/modules/extension/extension.module'
import { TerminalHistoryModule } from 'src/modules/terminal-history/terminal-history.module'
import { SafeBoxDbModule } from 'src/modules/repositories/safe-box-db/safe-box-db.module'
import { TelegramMiniAppModule } from 'src/modules/telegram-mini-app'
import { AuthModule, CsrfGuard, UserTypesGuard } from 'src/modules/auth'
import { SupportModule } from 'src/modules/support'
import { AdminModule } from 'src/modules/admin'
import environments from 'src/environments'
import { MONGO_URL } from 'src/shared/constants'
import { MigrationsModule } from 'src/migrations/migrations.module'

@Module({
  imports: [
    MongooseModule.forRoot(MONGO_URL),
    BullModule.forRoot({
      connection: {
        host: new URL(environments.REDIS_URL || 'redis://localhost:6379').hostname,
        port: Number(new URL(environments.REDIS_URL || 'redis://localhost:6379').port) || 6379,
        password: new URL(environments.REDIS_URL || 'redis://localhost:6379').password || undefined
      }
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    RedisModule,
    ProxyModule,
    ScraperWorkerModule,
    AuthModule,
    TraderDbModule,
    TransactoModule,
    TerminalModule,
    OrderDbModule,
    WebhookModule,
    OrderPollingModule,
    BankScraperModule,
    ExtensionModule,
    TerminalHistoryModule,
    SafeBoxDbModule,
    TelegramMiniAppModule,
    SupportModule,
    AdminModule,
    // Not to run anything — migrations are started by a person. It is here so
    // the API says on boot when one is pending, which is the failure that
    // actually happens: a deploy that shipped the code and forgot the data.
    MigrationsModule
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    },
    // Logs every failed request and then defers to Nest's own filter, so status
    // codes and bodies are unchanged. Without it a request rejected before its
    // handler — by the pipe above, routinely — left no trace at all.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guards run in registration order. CSRF first: it is a cheap header
    // comparison and must not depend on a DB round-trip having succeeded.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: UserTypesGuard }
  ]
})
export class AppModule {}
