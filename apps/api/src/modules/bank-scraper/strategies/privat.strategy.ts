import { ERROR } from '@transacto/contracts'
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { BankProvider } from 'src/shared/constants'
import type { UnifiedBankBalance } from 'src/shared/interfaces'
import { adaptPrivatBalance, ensure, extractPrivatRefEnv } from 'src/shared/utils'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import { BankScraperApiService } from 'src/modules/bank-scraper/services/bank-scraper.api.service'
import { PRIVAT_SESSION_TTL_SECONDS } from 'src/modules/bank-scraper/constants'
import type { PrivatSessionData, ScraperStrategy } from 'src/modules/bank-scraper/interfaces'

/** Statuses that mean the cached handshake is stale rather than the jar being gone. */
const SESSION_EXPIRED_STATUSES: ReadonlySet<number> = new Set([401, 403, 502])

@Injectable()
export class PrivatScraperStrategy implements ScraperStrategy {
  readonly provider = BankProvider.PRIVAT

  private readonly logger = new Logger(PrivatScraperStrategy.name)

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly apiService: BankScraperApiService
  ) {}

  async scrapeBalance(terminal: Terminal): Promise<UnifiedBankBalance> {
    const cred3 = ensure(terminal.cred3, new BadRequestException(ERROR.TERMINAL.MISSING_CRED))

    const hash = ensure(
      this.extractHash(cred3),
      new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)
    )

    return this.scrapeWithSession(terminal.terminalId, hash)
  }

  /**
   * PrivatBank needs a handshake before it serves a balance, and the handshake
   * expires without warning. The session is cached for an hour and, on the
   * first failure that looks like expiry, dropped and rebuilt exactly once —
   * `isRetry` is what stops a dead credential from looping forever.
   */
  private async scrapeWithSession(
    terminalId: number,
    hash: string,
    isRetry = false
  ): Promise<UnifiedBankBalance> {
    const sessionKey = RedisKeys.Privat.session(terminalId)
    let session = await this.readCachedSession(sessionKey)

    if (!session) {
      session = await this.openSession(hash)
      // Only a freshly opened session is written — re-caching a hit would keep
      // refreshing the TTL and a stale handshake would never age out.
      await this.redis.set(sessionKey, JSON.stringify(session), 'EX', PRIVAT_SESSION_TTL_SECONDS)
    }

    try {
      return adaptPrivatBalance(await this.apiService.fetchPrivatBalance(session))
    } catch (error) {
      if (!isRetry && this.looksLikeExpiredSession(error)) {
        this.logger.warn(
          `PrivatBank scrape failed for terminal ${terminalId}. Invalidating session and retrying once...`
        )
        await this.redis.del(sessionKey)
        return this.scrapeWithSession(terminalId, hash, true)
      }

      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error scraping PrivatBank balance for terminal ${terminalId}: ${message}`)
      throw error
    }
  }

  /** Runs the two handshake calls and assembles a session. */
  private async openSession(hash: string): Promise<PrivatSessionData> {
    const { xref, pubkey } = await this.apiService.initPrivatSession(hash)

    ensure(
      xref && pubkey,
      new BadRequestException({
        ...ERROR.SCRAPER.PROCESSING_FAILED,
        details: 'Failed to retrieve xref or pubkey during PrivatBank initialization (Step 1)'
      })
    )

    const refEnv = ensure(
      extractPrivatRefEnv(await this.apiService.fetchPrivatZipLink(hash, xref as string, pubkey)),
      new BadRequestException({
        ...ERROR.SCRAPER.PROCESSING_FAILED,
        details: 'Failed to retrieve refEnv from ZipLink response (Step 2)'
      })
    )

    return { hash, pubkey, xref: xref as string, refEnv }
  }

  private async readCachedSession(sessionKey: string): Promise<PrivatSessionData | null> {
    const cached = await this.redis.get(sessionKey)
    if (!cached) return null

    try {
      return JSON.parse(cached) as PrivatSessionData
    } catch {
      this.logger.warn(`Discarding unparseable cached session at ${sessionKey}`)
      return null
    }
  }

  private looksLikeExpiredSession(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status !== undefined && SESSION_EXPIRED_STATUSES.has(status)) return true

    return error instanceof Error && error.message.includes('session')
  }

  private extractHash(url: string): string | null {
    try {
      const parts = new URL(url).pathname.split('/')
      return parts[parts.length - 1] || null
    } catch {
      return null
    }
  }
}
