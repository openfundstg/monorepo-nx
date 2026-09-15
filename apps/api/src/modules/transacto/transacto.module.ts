import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import environments from 'src/environments'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
      baseURL: environments.TRADER_API_BASE_URL,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })
  ],
  providers: [TransactoApiService],
  exports: [TransactoApiService]
})
export class TransactoModule {}
