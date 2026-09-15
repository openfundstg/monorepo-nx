import { Global, Module } from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis/redis.constants'
import environments from 'src/environments'

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        return new Redis(environments.REDIS_URL || 'redis://localhost:6379')
      }
    }
  ],
  exports: [REDIS_CLIENT]
})
export class RedisModule {}
