import { Injectable, Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { AdminWsEventNames } from '@transacto/contracts'
import { ADMIN_SESSION, AdminSessionService } from 'src/modules/auth'
import { ADMIN_ROOM } from 'src/modules/admin/constants'

/**
 * The `/admin` namespace — one room, every operator in it.
 *
 * A third namespace alongside `/extension` and `/tma`, separate for the reason
 * those two are separate from each other: this room carries every user's and
 * every trader's traffic, which is exactly what must never leak into either of
 * the others. A shared namespace with room filtering would put that separation
 * in a `to()` call somebody can forget.
 *
 * There is no per-resource room. Operators are a handful of people watching the
 * whole system, so the payload volume is the system's write rate rather than a
 * multiple of it, and filtering client-side costs nothing — whereas per-resource
 * rooms would need join/leave plumbing on every navigation.
 *
 * Authentication happens once, here, at handshake: the `admin_session` cookie
 * the browser sends with the upgrade request. That is why the cookie is scoped
 * to `/` rather than to `/api/admin` — the Socket.IO endpoint is not under the
 * API prefix, and script cannot read an `HttpOnly` cookie to pass it by hand.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/admin' })
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminGateway.name)

  @WebSocketServer()
  server: Server

  /** How many operators are connected right now — see {@link hasListeners}. */
  private connections = 0

  constructor(private readonly sessionService: AdminSessionService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const sessionId = this.sessionService.readCookie(client.handshake, ADMIN_SESSION.COOKIE_NAME)
      if (!sessionId) {
        this.logger.warn(`Admin socket ${client.id} rejected: no session cookie`)
        client.disconnect(true)
        return
      }

      const principal = await this.sessionService.resolve(sessionId)
      if (!principal) {
        this.logger.warn(`Admin socket ${client.id} rejected: unknown or expired session`)
        client.disconnect(true)
        return
      }

      await client.join(ADMIN_ROOM)
      client.data.username = principal.username
      client.data.counted = true
      this.connections += 1
      this.logger.log(`Admin socket ${client.id} joined as ${principal.username}`)
    } catch (error: unknown) {
      this.logger.error(
        `Admin socket ${client.id} failed to connect: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      client.disconnect(true)
    }
  }

  handleDisconnect(client: Socket): void {
    // Only sockets that were actually counted decrement. A rejected handshake
    // still fires this hook, and without the flag every failed connection would
    // drive the counter negative — at which point `hasListeners` would answer
    // `false` with operators watching.
    if (client.data.counted) {
      client.data.counted = false
      this.connections = Math.max(0, this.connections - 1)
    }

    this.logger.debug(`Admin socket ${client.id} disconnected`)
  }

  /**
   * Whether anybody is actually watching.
   *
   * Read by `AdminBroadcastService` *before* it does any work. Its handlers sit
   * on the trader `ws.emit` bus and on every Mini App balance push — the
   * busiest paths in the system — and each one re-reads the row it announces.
   * Without this check, a scrape would cost an extra indexed lookup for a panel
   * nobody has open, on every terminal, forever.
   *
   * Tracked as a counter rather than read off the adapter: `sockets.adapter` is
   * an async API on some adapters, and this is called synchronously from
   * listeners that must not await anything they do not have to.
   */
  hasListeners(): boolean {
    return this.connections > 0
  }

  /**
   * Pushes one event to every connected operator.
   *
   * Guarded on `server` because a gateway whose namespace has never been
   * initialised has none, and every caller here is an event listener on a hot
   * path — a scrape must not fail because nobody has the panel open.
   */
  emit<T>(event: AdminWsEventNames, payload: T): void {
    if (!this.server) return

    this.server.to(ADMIN_ROOM).emit(event, payload)
  }
}
