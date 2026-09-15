import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Trader, TraderSchema } from './schemas'
import { TraderDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: Trader.name, schema: TraderSchema }])],
  providers: [TraderDbService],
  exports: [TraderDbService]
})
export class TraderDbModule {}
