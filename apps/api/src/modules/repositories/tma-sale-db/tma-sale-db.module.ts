import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaSale, TmaSaleSchema } from './schemas'
import { TmaSaleDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: TmaSale.name, schema: TmaSaleSchema }])],
  providers: [TmaSaleDbService],
  exports: [TmaSaleDbService]
})
export class TmaSaleDbModule {}
