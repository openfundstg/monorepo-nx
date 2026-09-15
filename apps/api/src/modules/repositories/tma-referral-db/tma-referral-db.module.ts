import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaReferralEarning, TmaReferralEarningSchema } from './schemas'
import { TmaReferralDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TmaReferralEarning.name, schema: TmaReferralEarningSchema }
    ])
  ],
  providers: [TmaReferralDbService],
  exports: [TmaReferralDbService]
})
export class TmaReferralDbModule {}
