import { Inject, Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { KOPECKS_PER_UAH } from '@transacto/contracts'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import { AlertType } from 'src/modules/repositories/alerts-db/schemas'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TerminalBroadcastService } from './terminal-broadcast.service'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { REDIS_CLIENT, terminalRedisKeys } from 'src/shared/redis'

/** Everything taking a terminal out of service needs to know. */
export interface TerminalDeactivation {
  /**
   * The Transacto terminal id, which is what Redis keys and alerts are filed
   * under. `null` for a sale that failed before Transacto answered.
   */
  readonly terminalId: number | null
  readonly traderId: number
  readonly cardId: number
  /** Named in every log line, so an operator knows which ending they are reading. */
  readonly reason: string
  /**
   * The trader's token, when Transacto should be told as well.
   *
   * Omitted when the terminal is already gone upstream — the terminals sync
   * stands down a credential that has vanished from `credentials_list`, and
   * there is nothing left there to switch off.
   */
  readonly apiToken?: string
  /**
   * Bring the credential's turnover caps down to this, in UAH kopecks.
   *
   * Only a completion passes one. A credential is created with its turnover
   * capped at its order's target, so an order that closes short leaves headroom
   * behind it — enough for a payer to be routed into a jar whose sale
   * has already been paid out. A cancelled or blocked order is a teardown
   * rather than a settlement, and rewriting its limits would state something
   * about the money that is not true.
   */
  readonly settledKopecks?: number
}

/**
 * The one place a terminal is taken out of service.
 *
 * Three call sites used to do this, each slightly differently, and the
 * differences were accidents rather than decisions:
 *
 * - the sale teardown told Transacto, cleared the jar-full warning,
 *   wrote Mongo and cleared Redis;
 * - the scraper's error handler told Transacto and wrote Mongo **inside one
 *   `try`**, so a Transacto hiccup skipped the local write and left the
 *   terminal enabled here — and it cleared Redis on a dead jar but *not* on a
 *   fraud, which left a stale baseline behind. A terminal re-enabled after that
 *   compares today's balance against a figure from before it went away, reads
 *   an emptied jar as a withdrawal, and disables itself for fraud all over
 *   again;
 * - the terminals sync wrote Mongo and cleared Redis, and told Transacto
 *   nothing — correctly, since the credential had vanished from upstream.
 *
 * Only the third difference was intentional, and it survives as
 * {@link TerminalDeactivation.apiToken}. The rest are gone.
 *
 * **`credentials_delete` is deliberately never called.** Archiving is the only
 * thing that would make `terminal_is_active` false upstream — `credentials_update`
 * accepts neither that field nor `terminal_is_archived` — but it cannot be
 * undone: a credential that has been archived has to be created again, with a
 * new `card_id` and a new `terminal_id`. Standing a terminal down is reversible
 * and that is worth keeping, not least because the fraud path fires on *any*
 * balance decrease and raises a suspicion for a human to review. So the flag
 * stays `true` on a disabled terminal, on purpose.
 *
 * **The order of the four steps is load-bearing and the failure semantics are
 * deliberate.** Everything upstream is best-effort and logged; the local writes
 * always run. A terminal that is disabled here but still enabled on Transacto
 * keeps having payers routed to a jar nobody watches — bad, and visible in the
 * log. A terminal disabled on Transacto but still enabled here is worse: the
 * scraper keeps polling a dead credential forever, and nothing says why.
 */
@Injectable()
export class TerminalDeactivationService {
  private readonly logger = new Logger(TerminalDeactivationService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly alertsService: AlertsService,
    private readonly broadcast: TerminalBroadcastService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /** Never throws. By the time this runs the decision is already made. */
  async deactivate(request: TerminalDeactivation): Promise<void> {
    const { terminalId, traderId, cardId, reason, apiToken } = request

    if (apiToken) await this.standDownUpstream(request, apiToken)

    await this.clearJarFullWarning(terminalId, reason)

    // Mongo before Redis, always. `loopActive` is among the keys cleared below,
    // and the watchdog reads a missing heartbeat on an *enabled* terminal as a
    // loop to revive — so clearing first would restart the very loop this is
    // shutting down.
    // `acceptingOrders` back to true alongside: it marks a terminal winding down
    // *while still in service*, and a teardown ends that window. Leaving it
    // false would also pin `TerminalsSyncService.resolveEnabled` to "leave it
    // alone" for good, so upstream could never switch this terminal back on.
    await this.terminalDbService.updateOne(
      { traderId, cardId },
      { $set: { enabled: false, acceptingOrders: true } }
    )

    if (terminalId !== null) await this.redis.del(...terminalRedisKeys(terminalId))

    // Last, and only once everything else is done: the client drops the card on
    // this, so announcing earlier would take it off screen while the terminal
    // was still half in service.
    if (terminalId !== null) this.broadcast.announceDisabled(traderId, terminalId, cardId)

    this.logger.log(
      `${reason}: terminal ${terminalId ?? '(none)'} (card_id ${cardId}, trader ${traderId}) ` +
        `is out of service`
    )
  }

  /**
   * Stops new payers being routed here, without taking the terminal out of
   * service.
   *
   * The narrow half of {@link deactivate}, for a sale the user has
   * asked to end while orders are still outstanding. `enable_orders: 0` alone:
   * `enabled` stays `1` upstream and `true` locally, Redis is left intact, and
   * no `TERMINAL_DISABLED` goes out.
   *
   * **Everything about that is deliberate.** A payer already holding an order
   * can still pay it — the Trader API has no way to cancel one, so it will be
   * paid or it will time out — and the only thing that ever sees that money is
   * the scrape loop, which the watchdog runs from `find({ enabled: true })`.
   * Switching the terminal off here would leave the jar taking hryvnia nobody
   * is watching, and the sale would then refund the whole stake while
   * the user kept the money.
   *
   * The local `acceptingOrders: false` is not merely a display flag: the
   * terminals sync reads upstream `enable_orders` back into the local `enabled`,
   * so without it the very next pass would disable this terminal a minute later
   * and undo the arrangement. See `TerminalsSyncService.resolveEnabled`.
   *
   * Never throws — like `deactivate`, the decision is already made by the time
   * this runs. An upstream failure is logged and leaves the terminal routing,
   * which is visible and recoverable; the local flag is written regardless.
   */
  async stopRouting(request: TerminalDeactivation): Promise<void> {
    const { terminalId, traderId, cardId, reason, apiToken } = request

    if (apiToken) {
      try {
        await this.transactoApiService.updateTerminals(apiToken, {
          card_id: cardId,
          // Not `enabled`, and no turnover caps. Both belong to a teardown, and
          // this terminal is still expected to take the money it is owed.
          enable_orders: 0
        })
      } catch (error: unknown) {
        this.logger.error(
          `${reason}: could not stop order routing for card_id ${cardId} on Transacto — new ` +
            `payers may still be sent there: ${this.describe(error)}`
        )
      }
    }

    await this.terminalDbService.updateOne({ traderId, cardId }, { $set: { acceptingOrders: false } })

    this.logger.log(
      `${reason}: terminal ${terminalId ?? '(none)'} (card_id ${cardId}, trader ${traderId}) ` +
        `is winding down — still watched, no new orders`
    )
  }

  /**
   * `enabled: 0, enable_orders: 0` — what actually stops payers being routed.
   *
   * Both flags, not just `enabled`: a credential left with `enable_orders: 1`
   * keeps taking orders, and the next terminals sync reads that flag back and
   * re-enables the local row, so a half teardown does not stay torn down.
   */
  private async standDownUpstream(
    request: TerminalDeactivation,
    apiToken: string
  ): Promise<void> {
    try {
      await this.transactoApiService.updateTerminals(apiToken, {
        card_id: request.cardId,
        enabled: 0,
        enable_orders: 0,
        ...this.turnoverCaps(request.settledKopecks)
      })
    } catch (error: unknown) {
      this.logger.error(
        `${request.reason}: could not disable card_id ${request.cardId} on Transacto — it may ` +
          `keep routing orders there: ${this.describe(error)}`
      )
    }
  }

  /**
   * The jar-full warning dies with the terminal that raised it.
   *
   * It asks a trader to pay the last stretch into a jar by hand. Once the
   * terminal is out of service nobody ever will — and nothing is left to clear
   * it either, because the check that resolves one only runs on a scrape. It
   * stayed pending for good, and an unread alert keeps a disabled terminal in
   * the trader's "active jars".
   *
   * Only this one type. An unrecognised deposit, an ambiguous one, a fraud
   * suspicion or an order still awaiting confirmation in the cabinet all want a
   * human after the terminal is gone too; clearing those would hide them.
   */
  private async clearJarFullWarning(terminalId: number | null, reason: string): Promise<void> {
    if (terminalId === null) return

    try {
      await this.alertsService.resolvePendingAlertsForJar(terminalId, [
        AlertType.TERMINAL_FULL_WARNING
      ])
    } catch (error: unknown) {
      this.logger.error(
        `${reason}: could not resolve the jar-full warning on terminal ${terminalId}: ` +
          `${this.describe(error)}`
      )
    }
  }

  /**
   * The three turnover caps, in the whole hryvnia Transacto takes, or nothing.
   *
   * All three together because `credentials_create` sets all three together:
   * leaving `limit_by_day` where it was while `max_turnover` came down would cap
   * the credential at the lower of the two anyway, and the two would then
   * disagree about why.
   */
  private turnoverCaps(settledKopecks?: number): Record<string, number> {
    if (settledKopecks === undefined || settledKopecks < 0) return {}

    const uah = settledKopecks / KOPECKS_PER_UAH

    return { max_turnover: uah, max_turnover_daily: uah, limit_by_day: uah }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
