import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Terminal, TerminalSchema } from './schemas'
import { TerminalDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: Terminal.name, schema: TerminalSchema }])],
  providers: [TerminalDbService],
  exports: [TerminalDbService]
})
export class TerminalDbModule {}
