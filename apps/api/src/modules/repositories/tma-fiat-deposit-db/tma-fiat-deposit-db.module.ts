import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaFiatDeposit, TmaFiatDepositSchema } from './schemas'
import { TmaFiatDepositDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TmaFiatDeposit.name, schema: TmaFiatDepositSchema }])
  ],
  providers: [TmaFiatDepositDbService],
  exports: [TmaFiatDepositDbService]
})
export class TmaFiatDepositDbModule {}
