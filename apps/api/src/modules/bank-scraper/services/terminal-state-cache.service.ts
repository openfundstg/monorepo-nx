import { Injectable, Inject, Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import { RedisKeys } from 'src/shared/redis/redis.keys'
import { EventEmitter2 } from '@nestjs/event-emitter'

@Injectable()
export class TerminalStateCacheService {
  private readonly logger = new Logger(TerminalStateCacheService.name)

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async acquireLock(terminalId: number, ttlMs = 7000): Promise<boolean> {
    const lockKey = RedisKeys.Terminal.lock(terminalId)
    const result = await this.redis.set(lockKey, '1', 'PX', ttlMs, 'NX')
    return result === 'OK'
  }

  async releaseLock(terminalId: number): Promise<void> {
    const lockKey = RedisKeys.Terminal.lock(terminalId)
    await this.redis.del(lockKey)
  }

  async setThrottle(terminalId: number, ttlMs: number): Promise<void> {
    const throttleKey = RedisKeys.Terminal.throttle(terminalId)
    await this.redis.set(throttleKey, '1', 'PX', ttlMs)
  }

  async isThrottled(terminalId: number): Promise<boolean> {
    const throttleKey = RedisKeys.Terminal.throttle(terminalId)
    const val = await this.redis.get(throttleKey)
    return !!val
  }

  async getBaseline(terminalId: number): Promise<number | null> {
    const baselineKey = RedisKeys.Terminal.baseline(terminalId)
    const baselineStr = await this.redis.get(baselineKey)
    return baselineStr ? Number(baselineStr) : null
  }

  /**
   * Accounts for money that was settled without the jar being read.
   *
   * **The baseline is "how much of the jar is already explained", and an order
   * settled outside the matcher leaves its hryvnia unexplained.** Transacto's
   * `order.paid` — an operator confirming a payment in their panel — removes the
   * order from the pending pool without anything here moving, so the money that
   * paid for it stays inside the next delta and is offered to whichever orders
   * are pending then. It cost 606 UAH of a user's USDT to learn that: two
   * orders were executed against a delta that had already been spent on two
   * others.
   *
   * `INCRBY` rather than read-modify-write, because two confirmations can land
   * in the same millisecond and the lost update would be exactly the phantom
   * this exists to prevent.
   *
   * Returns the new baseline, or `null` when there is none to advance — a
   * terminal with no baseline has no scrape loop running, so there is no delta
   * for the money to be double-spent from. The check is not atomic with the
   * increment; a baseline created in that window is simply not advanced, which
   * is today's behaviour and never worse than it.
   */
  async advanceBaseline(terminalId: number, byKopecks: number): Promise<number | null> {
    if (byKopecks <= 0) return null

    const baselineKey = RedisKeys.Terminal.baseline(terminalId)

    if ((await this.redis.exists(baselineKey)) === 0) return null

    return this.redis.incrby(baselineKey, byKopecks)
  }

  async updateBaseline(
    terminalId: number,
    balance: number,
    context?: { orderEvents?: unknown[]; alerts?: unknown[]; deferEvent?: boolean }
  ): Promise<void> {
    const baselineKey = RedisKeys.Terminal.baseline(terminalId)
    const oldBaselineStr = await this.redis.get(baselineKey)
    const oldBaseline = oldBaselineStr ? Number(oldBaselineStr) : null

    await this.redis.set(baselineKey, balance.toString())

    if (
      !context?.deferEvent &&
      (oldBaseline !== balance ||
        (context && (context.orderEvents?.length || context.alerts?.length)))
    ) {
      const currentKey = RedisKeys.Terminal.current(terminalId)
      const currentVal = await this.redis.get(currentKey)
      const current = currentVal ? JSON.parse(currentVal).current : balance
      this.eventEmitter.emit('terminal.state_changed', {
        terminalId,
        baseline: balance,
        current,
        context
      })
    }
  }

  async updateCurrentState(
    terminalId: number,
    current: number,
    goal?: number,
    context?: { orderEvents?: unknown[]; alerts?: unknown[]; deferEvent?: boolean }
  ): Promise<void> {
    const currentKey = RedisKeys.Terminal.current(terminalId)
    const val = await this.redis.get(currentKey)
    const oldCurrent = val ? JSON.parse(val).current : null

    const payload = { current, goal }
    await this.redis.set(currentKey, JSON.stringify(payload), 'EX', 3600)

    if (
      !context?.deferEvent &&
      (oldCurrent !== current ||
        (context && (context.orderEvents?.length || context.alerts?.length)))
    ) {
      const baselineKey = RedisKeys.Terminal.baseline(terminalId)
      const baselineStr = await this.redis.get(baselineKey)
      const baseline = baselineStr ? Number(baselineStr) : current
      this.eventEmitter.emit('terminal.state_changed', { terminalId, current, baseline, context })
    }
  }

  async getCurrentState(terminalId: number): Promise<{ current: number; goal?: number } | null> {
    const currentKey = RedisKeys.Terminal.current(terminalId)
    const val = await this.redis.get(currentKey)
    if (!val) return null
    try {
      return JSON.parse(val)
    } catch {
      return null
    }
  }

  /**
   * Records that a balance below the baseline has been seen, and says since when.
   *
   * The first observation wins: the value is written only if the key is absent
   * (`NX`), so repeated readings during one drop keep measuring from where the
   * drop started rather than restarting the clock on every poll.
   *
   * `isFirst` is what the caller acts on rather than merely reports. A drop
   * pauses order routing upstream, and that is a call to Transacto — it belongs
   * on the transition into the drop, not on every poll inside it. Redis decides
   * which reading that is, because `SET NX` is the only part of this that is
   * atomic across two workers looking at the same terminal.
   *
   * @returns how long the drop has persisted, and whether this reading opened it.
   */
  async markDropSeen(
    terminalId: number,
    ttlMs: number
  ): Promise<{ persistedMs: number; isFirst: boolean }> {
    const key = RedisKeys.Terminal.dropSeenAt(terminalId)
    const now = Date.now()

    const written = await this.redis.set(key, now.toString(), 'PX', ttlMs, 'NX')

    const firstSeen = await this.redis.get(key)
    // A key that expired between the write and the read leaves nothing to
    // measure from. Reading that as "no time has passed" restarts the wait,
    // which is the safe direction: it delays an alert rather than raising one.
    if (firstSeen === null) return { persistedMs: 0, isFirst: written === 'OK' }

    return { persistedMs: Math.max(0, now - Number(firstSeen)), isFirst: written === 'OK' }
  }

  /**
   * Forgets the drop in progress, because the balance came back.
   *
   * Called on every reading at or above the baseline — including the ones where
   * nothing was being tracked — so the key can never describe an older drop
   * than the one happening now.
   *
   * @returns whether a drop was actually in progress, which is how the caller
   *   knows there is a paused terminal to put back into service. Reading it off
   *   the delete keeps the question atomic: two workers cannot both decide they
   *   were the one that ended the drop.
   */
  async clearDropSeen(terminalId: number): Promise<boolean> {
    return (await this.redis.del(RedisKeys.Terminal.dropSeenAt(terminalId))) > 0
  }

  /**
   * True when a balance broadcast is worth sending.
   *
   * The scraper polls every ~5s per terminal whether or not anything moved, and
   * every poll used to push a WebSocket event to every connected extension. This
   * suppresses the identical ones: the signature is stored with a TTL of
   * `heartbeatMs`, so an unchanged terminal re-broadcasts only once that expires.
   *
   * The heartbeat is not optional — the extension marks a terminal as no longer
   * polling when its `lastUpdated` goes stale, so silence would read as "dead".
   * Keep `heartbeatMs` comfortably below that threshold.
   */
  async shouldBroadcast(
    terminalId: number,
    signature: string,
    heartbeatMs: number
  ): Promise<boolean> {
    const key = RedisKeys.Terminal.lastBroadcast(terminalId)
    const previous = await this.redis.get(key)

    if (previous === signature) return false

    await this.redis.set(key, signature, 'PX', heartbeatMs)
    return true
  }

  async renewHeartbeat(terminalId: number, ttlSeconds: number): Promise<void> {
    await this.redis.set(RedisKeys.Terminal.loopActive(terminalId), '1', 'EX', ttlSeconds)
  }

  async isHeartbeatActive(terminalId: number): Promise<boolean> {
    const val = await this.redis.get(RedisKeys.Terminal.loopActive(terminalId))
    return !!val
  }

  /**
   * Gives up the lease on a loop this process is no longer running.
   *
   * The lease says "somebody is polling this terminal", and the only proof of
   * that is the process whose timer fires the next scrape. When that process
   * stops, the lease is a claim nothing backs — and the watchdog, which is what
   * revives dead loops, believes it for as long as the TTL has left. That is
   * the whole of the delay after a restart: the new process starts, asks which
   * loops are dead, and is told by the old one's leases that they are all fine.
   *
   * Called on shutdown, terminal by terminal, so a process only ever withdraws
   * its own claims. Another instance's leases are untouched, because they are
   * still true.
   */
  async releaseHeartbeat(terminalId: number): Promise<void> {
    await this.redis.del(RedisKeys.Terminal.loopActive(terminalId))
  }
}
