import { EventEmitter2 } from '@nestjs/event-emitter'
import { TerminalStateCacheService } from './terminal-state-cache.service'

/** In-memory stand-in for the bits of ioredis this service uses. */
const createRedis = () => {
  const store = new Map<string, { value: string; expiresAt: number | null }>()
  let now = 0

  return {
    advance: (ms: number) => (now += ms),
    get: jest.fn(async (key: string) => {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        store.delete(key)
        return null
      }
      return entry.value
    }),
    set: jest.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      const expiresAt = mode === 'PX' && ttl ? now + ttl : null
      store.set(key, { value, expiresAt })
      return 'OK'
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  }
}

describe('TerminalStateCacheService.shouldBroadcast', () => {
  const HEARTBEAT_MS = 15_000
  const TERMINAL = 23893

  let redis: ReturnType<typeof createRedis>
  let service: TerminalStateCacheService

  beforeEach(() => {
    redis = createRedis()
    service = new TerminalStateCacheService(redis as never, new EventEmitter2())
  })

  const ask = (signature: string) => service.shouldBroadcast(TERMINAL, signature, HEARTBEAT_MS)

  it('broadcasts the first time it sees a terminal', async () => {
    await expect(ask('5000|false|0')).resolves.toBe(true)
  })

  it('suppresses an identical repeat', async () => {
    // The scraper polls every ~5s whether or not anything moved
    await ask('5000|false|0')

    await expect(ask('5000|false|0')).resolves.toBe(false)
    await expect(ask('5000|false|0')).resolves.toBe(false)
  })

  it('broadcasts as soon as anything the trader can see changes', async () => {
    await ask('5000|false|0')

    await expect(ask('9600|false|0')).resolves.toBe(true) // balance moved
    await expect(ask('9600|true|9600')).resolves.toBe(true) // an order is now pending
  })

  it('broadcasts again once the heartbeat elapses, so the terminal is not read as dead', async () => {
    // The extension marks a terminal as no longer polling when its lastUpdated
    // goes stale, so silence cannot be allowed to continue indefinitely.
    await ask('5000|false|0')
    expect(await ask('5000|false|0')).toBe(false)

    redis.advance(HEARTBEAT_MS + 1)

    await expect(ask('5000|false|0')).resolves.toBe(true)
  })

  it('restarts the heartbeat from the last broadcast, not the last poll', async () => {
    await ask('5000|false|0')

    redis.advance(HEARTBEAT_MS - 1)
    expect(await ask('5000|false|0')).toBe(false) // still inside the window

    redis.advance(2)
    await expect(ask('5000|false|0')).resolves.toBe(true)
  })
})
