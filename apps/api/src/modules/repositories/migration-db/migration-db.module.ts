import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Migration, MigrationLock, MigrationLockSchema, MigrationSchema } from './schemas'
import { MigrationDbService } from './services'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Migration.name, schema: MigrationSchema },
      { name: MigrationLock.name, schema: MigrationLockSchema }
    ])
  ],
  providers: [MigrationDbService],
  exports: [MigrationDbService]
})
export class MigrationDbModule {}
