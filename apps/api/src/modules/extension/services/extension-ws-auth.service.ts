import { Injectable, Logger } from '@nestjs/common'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { Socket } from 'socket.io'

@Injectable()
export class ExtensionWsAuthService {
  private readonly logger = new Logger(ExtensionWsAuthService.name)

  constructor(private readonly traderDbService: TraderDbService) {}

  async validateAndAssignRoom(client: Socket): Promise<boolean> {
    const apiToken = client.handshake.auth?.token || client.handshake.query?.token

    if (!apiToken || typeof apiToken !== 'string') {
      this.logger.warn(`Client ${client.id} tried to connect without token.`)
      return false
    }

    const trader = await this.traderDbService.findByApiToken(apiToken)
    if (!trader || !trader.isActive) {
      this.logger.warn(`Client ${client.id} tried to connect with invalid/inactive token.`)
      return false
    }

    const roomName = `trader_${trader.traderId}`
    client.join(roomName)
    this.logger.log(`Client ${client.id} joined room ${roomName}`)

    client.data.traderId = trader.traderId
    return true
  }
}
