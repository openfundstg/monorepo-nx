import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaBalanceEntry, TmaBalanceEntrySchema } from './schemas'
import { TmaBalanceEntryDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TmaBalanceEntry.name, schema: TmaBalanceEntrySchema }])
  ],
  providers: [TmaBalanceEntryDbService],
  exports: [TmaBalanceEntryDbService]
})
export class TmaBalanceEntryDbModule {}
