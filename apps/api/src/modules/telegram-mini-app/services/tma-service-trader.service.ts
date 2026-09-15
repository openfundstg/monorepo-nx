import { ERROR } from '@transacto/contracts'
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit
} from '@nestjs/common'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import environments from 'src/environments'

/** What every caller actually needs: who owns the Mini App's terminals upstream. */
export interface ServiceTrader {
  readonly traderId: number
  readonly apiToken: string
}

/**
 * Resolves `TMA_SERVICE_TRADER_API_TOKEN` to the real trader that owns every
 * terminal the Mini App creates.
 *
 * Why this exists: terminals were previously upserted under a literal
 * `traderId: 0`. Nothing else in the system uses that id — the scraper, the
 * terminal sync cron, the order poller and the watchdog all key terminals by
 * `{ traderId, cardId }` against an *active trader row* — so a Mini App terminal
 * was invisible to all of them. It was never scraped, its orders were never
 * polled, and consequently a sale could never observe its own money
 * arriving. Resolving the token to its actual trader id, and registering that
 * trader, is what puts Mini App jars on the same rails as extension ones.
 *
 * The resolution is cached for the process lifetime: the token is static
 * configuration, and `getTraderProfile` is a network call that would otherwise
 * run on every sale.
 */
@Injectable()
export class TmaServiceTraderService implements OnModuleInit {
  private readonly logger = new Logger(TmaServiceTraderService.name)

  private cached: ServiceTrader | null = null

  /**
   * Deduplicates concurrent first-time resolutions. Two sales created
   * in the same tick would otherwise each hit the Transacto profile endpoint.
   */
  private inFlight: Promise<ServiceTrader> | null = null

  constructor(
    private readonly traderDbService: TraderDbService,
    private readonly transactoApiService: TransactoApiService
  ) {}

  /**
   * Registers the service trader at boot rather than lazily on first order.
   *
   * `TerminalsSyncService` iterates `findAllActive()` every minute; if the row
   * only appeared when someone happened to create a sale, terminals
   * created before that would sit unsynced until the next cron tick after it.
   *
   * A failure here must not stop the app: the API has to boot without Transacto
   * reachable, so this logs and leaves the lazy path to retry.
   */
  async onModuleInit(): Promise<void> {
    if (!environments.TMA_SERVICE_TRADER_API_TOKEN) {
      this.logger.warn(
        'TMA_SERVICE_TRADER_API_TOKEN is not set — Mini App sales cannot create terminals'
      )
      return
    }

    try {
      const trader = await this.resolve()
      this.logger.log(`Mini App service trader resolved to traderId ${trader.traderId}`)
    } catch (error) {
      this.logger.error(
        `Could not resolve the Mini App service trader at boot; will retry on first sale: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /** Resolves once, then serves from memory. */
  async resolve(): Promise<ServiceTrader> {
    if (this.cached) return this.cached
    if (this.inFlight) return this.inFlight

    this.inFlight = this.resolveUncached().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  private async resolveUncached(): Promise<ServiceTrader> {
    const apiToken = environments.TMA_SERVICE_TRADER_API_TOKEN
    if (!apiToken) throw new InternalServerErrorException(ERROR.CONFIG.MISSING_TRADER_API_TOKEN)

    // Already registered — typically because the same token was used to log in
    // through the Chrome extension, which upserts the same row.
    const existing = await this.traderDbService.findByApiToken(apiToken)
    if (existing) {
      if (!existing.isActive) {
        // A deactivated trader is skipped by the sync cron and the watchdog, so
        // leaving it inactive would silently stop every Mini App terminal.
        await this.traderDbService.activateTrader(existing.traderId)
        this.logger.log(`Re-activated Mini App service trader ${existing.traderId}`)
      }

      this.cached = { traderId: existing.traderId, apiToken }
      return this.cached
    }

    const profile = await this.transactoApiService.getTraderProfile(apiToken)
    const traderId = profile?.id

    if (typeof traderId !== 'number') {
      throw new InternalServerErrorException(ERROR.CONFIG.UNRESOLVABLE_TRADER_API_TOKEN)
    }

    await this.traderDbService.upsert(traderId, apiToken)
    this.logger.log(`Registered Mini App service trader ${traderId} from the configured token`)

    this.cached = { traderId, apiToken }
    return this.cached
  }
}
