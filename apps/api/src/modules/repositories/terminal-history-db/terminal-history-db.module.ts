import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TerminalHistory, TerminalHistorySchema } from './schemas'
import { TerminalHistoryDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TerminalHistory.name, schema: TerminalHistorySchema }])
  ],
  providers: [TerminalHistoryDbService],
  exports: [TerminalHistoryDbService]
})
export class TerminalHistoryDbModule {}
