import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaDeposit, TmaDepositSchema } from './schemas'
import { TmaDepositDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: TmaDeposit.name, schema: TmaDepositSchema }])],
  providers: [TmaDepositDbService],
  exports: [TmaDepositDbService]
})
export class TmaDepositDbModule {}
