import { Global, Module } from '@nestjs/common'
import { ProxyManagerService } from 'src/shared/proxy/proxy-manager.service'

/**
 * One pool of outbound addresses for the whole process.
 *
 * Global for the same reason `RedisModule` is: it is a connection to something
 * outside the process, every consumer wants the same one, and rotation only
 * means anything if the instance is shared — two pools would each think they
 * were on the first proxy.
 */
@Global()
@Module({
  providers: [ProxyManagerService],
  exports: [ProxyManagerService]
})
export class ProxyModule {}
