import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaUser, TmaUserSchema } from './schemas'
import { TmaUserDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: TmaUser.name, schema: TmaUserSchema }])],
  providers: [TmaUserDbService],
  exports: [TmaUserDbService]
})
export class TmaUserDbModule {}
