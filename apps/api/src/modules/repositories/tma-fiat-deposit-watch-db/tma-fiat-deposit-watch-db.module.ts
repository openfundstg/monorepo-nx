import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaFiatDepositWatch, TmaFiatDepositWatchSchema } from './schemas'
import { TmaFiatDepositWatchDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TmaFiatDepositWatch.name, schema: TmaFiatDepositWatchSchema }
    ])
  ],
  providers: [TmaFiatDepositWatchDbService],
  exports: [TmaFiatDepositWatchDbService]
})
export class TmaFiatDepositWatchDbModule {}
