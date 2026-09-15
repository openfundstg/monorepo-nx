import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SafeBoxDeposit, SafeBoxDepositSchema } from './schemas'
import { SafeBoxDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SafeBoxDeposit.name, schema: SafeBoxDepositSchema }])
  ],
  providers: [SafeBoxDbService],
  exports: [SafeBoxDbService]
})
export class SafeBoxDbModule {}
