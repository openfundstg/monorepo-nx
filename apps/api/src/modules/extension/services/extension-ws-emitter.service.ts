import { Injectable, Logger, Inject } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ExtensionGateway } from '../gateways/extension.gateway'
import { TraderWsEvent } from 'src/shared/interfaces'

@Injectable()
export class ExtensionWsEmitterService {
  private readonly logger = new Logger(ExtensionWsEmitterService.name)

  constructor(
    @Inject(ExtensionGateway)
    private readonly gateway: ExtensionGateway
  ) {}

  @OnEvent('ws.emit')
  handleWsEvent(payload: TraderWsEvent<any>) {
    this.logger.debug(`Emitting event ${payload.event} to trader ${payload.traderId}`)
    if (this.gateway.server) {
      this.gateway.server.to(`trader_${payload.traderId}`).emit(payload.event, payload.data)
    }
  }
}
