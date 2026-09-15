import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Alert, AlertSchema } from './schemas'
import { AlertDbService } from './services'

@Module({
  imports: [MongooseModule.forFeature([{ name: Alert.name, schema: AlertSchema }])],
  providers: [AlertDbService],
  exports: [AlertDbService]
})
export class AlertsDbModule {}
