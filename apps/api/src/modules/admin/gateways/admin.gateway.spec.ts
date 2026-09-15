import type { Socket } from 'socket.io'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { ADMIN_SESSION } from 'src/modules/auth'
import type { AdminSessionService } from 'src/modules/auth'

/**
 * `hasListeners` is read on the scraper's hot path, before any work is done —
 * so a counter that drifts is either a panel that silently stops updating or a
 * database query per scrape for nobody.
 */
describe('AdminGateway', () => {
  const sessionService = (resolves: boolean) =>
    ({
      readCookie: jest.fn(() => (resolves ? 'session-id' : null)),
      resolve: jest.fn(async () =>
        resolves ? { username: 'oleg', sessionId: 'session-id', csrfToken: 'x' } : null
      )
    }) as unknown as AdminSessionService

  const socket = () =>
    ({
      id: 'socket-1',
      handshake: { headers: { cookie: `${ADMIN_SESSION.COOKIE_NAME}=session-id` } },
      data: {} as Record<string, unknown>,
      join: jest.fn(async () => undefined),
      disconnect: jest.fn()
    }) as unknown as Socket

  it('reports no listeners before anyone connects', () => {
    expect(new AdminGateway(sessionService(true)).hasListeners()).toBe(false)
  })

  it('counts a socket that authenticated and joined', async () => {
    const gateway = new AdminGateway(sessionService(true))
    const client = socket()

    await gateway.handleConnection(client)

    expect(client.join).toHaveBeenCalledWith('admin')
    expect(gateway.hasListeners()).toBe(true)
  })

  it('stops counting once it disconnects', async () => {
    const gateway = new AdminGateway(sessionService(true))
    const client = socket()

    await gateway.handleConnection(client)
    gateway.handleDisconnect(client)

    expect(gateway.hasListeners()).toBe(false)
  })

  /**
   * A rejected handshake still fires `handleDisconnect`. Without the flag on
   * the socket, every failed connection would drive the counter negative — and
   * `hasListeners` would then answer `false` with operators watching.
   */
  it('does not decrement for a socket that never joined', async () => {
    const gateway = new AdminGateway(sessionService(true))
    const joined = socket()
    const rejected = { ...socket(), id: 'socket-2' } as unknown as Socket

    await gateway.handleConnection(joined)
    gateway.handleDisconnect(rejected)

    expect(gateway.hasListeners()).toBe(true)
  })

  it('rejects and does not count a socket with no session cookie', async () => {
    const gateway = new AdminGateway(sessionService(false))
    const client = socket()

    await gateway.handleConnection(client)

    expect(client.disconnect).toHaveBeenCalledWith(true)
    expect(client.join).not.toHaveBeenCalled()
    expect(gateway.hasListeners()).toBe(false)
  })

  it('survives a double disconnect without going negative', async () => {
    const gateway = new AdminGateway(sessionService(true))
    const client = socket()

    await gateway.handleConnection(client)
    gateway.handleDisconnect(client)
    gateway.handleDisconnect(client)

    expect(gateway.hasListeners()).toBe(false)
  })
})
