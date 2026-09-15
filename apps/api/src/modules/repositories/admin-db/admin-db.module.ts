import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AdminAuditLog, AdminAuditLogSchema } from 'src/modules/repositories/admin-db/schemas'
import { AdminAuditLogDbService } from 'src/modules/repositories/admin-db/services'

@Module({
  imports: [MongooseModule.forFeature([{ name: AdminAuditLog.name, schema: AdminAuditLogSchema }])],
  providers: [AdminAuditLogDbService],
  exports: [AdminAuditLogDbService]
})
export class AdminDbModule {}
