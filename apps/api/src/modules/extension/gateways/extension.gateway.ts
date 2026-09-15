import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { Logger } from '@nestjs/common'
import { ExtensionWsAuthService } from '../services/extension-ws-auth.service'

@WebSocketGateway({
  cors: {
    origin: '*' // Since it's a Chrome extension, we allow any origin
  },
  namespace: '/extension'
})
export class ExtensionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(ExtensionGateway.name)

  constructor(private readonly wsAuthService: ExtensionWsAuthService) {}

  async handleConnection(client: Socket) {
    const isValid = await this.wsAuthService.validateAndAssignRoom(client)
    if (!isValid) client.disconnect()
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`)
  }
}
