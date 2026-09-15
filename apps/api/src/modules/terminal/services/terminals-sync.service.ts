import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { Terminal as TerminalDoc } from 'src/modules/repositories/terminal-db/schemas'
import type { Terminal as TransactoTerminal } from 'src/shared/interfaces'
import { TerminalDeactivationService } from 'src/modules/terminal/services/terminal-deactivation.service'
import { TerminalBroadcastService } from 'src/modules/terminal/services/terminal-broadcast.service'
import environments, { NODE_ENV } from 'src/environments'
import { BANK_URL_KEYWORDS } from 'src/shared/constants/bank.constants'
import {
  classifyTerminalSource,
  describeErrors,
  settleStaggered,
  TRADER_REQUEST_STAGGER_MS
} from 'src/shared/utils'

/**
 * The two thresholds that stand between a bad `credentials_list` and a mass
 * outage.
 *
 * `MISSING_PASSES_BEFORE_DEACTIVATION` — one pass is not evidence.
 * `credentials_list` is a single unpaginated read of a list that grows with
 * every sale (the Mini App creates a terminal per order and never
 * deletes it, only disables it), so a truncated page, a partial response or a
 * read that raced a write all look exactly like "deleted upstream".
 * Deactivating clears the terminal's Redis state and stops its scraper loop, so
 * a false positive costs a live jar; waiting three minutes to stand down a
 * terminal that really is gone costs nothing.
 *
 * `MAX_DEACTIVATION_SHARE` — the empty-list guard generalised. A trader does
 * not delete most of their terminals between two cron ticks; a page boundary,
 * an upstream outage or a schema change does exactly that, and acting on it
 * takes every jar offline in one pass.
 *
 * `MIN_MASS_DEACTIVATION` — the share only says anything about a group. One
 * terminal going away is the ordinary case the deletion check exists for, and
 * on a trader with one or two terminals it is *always* more than half of them,
 * so measuring the share alone would mean a small trader's terminals could
 * never be stood down at all.
 */
export const TerminalSyncGuard = {
  MISSING_PASSES_BEFORE_DEACTIVATION: 3,
  MAX_DEACTIVATION_SHARE: 0.5,
  MIN_MASS_DEACTIVATION: 2
} as const

@Injectable()
export class TerminalsSyncService {
  private readonly logger = new Logger(TerminalsSyncService.name)
  private isSyncing = false

  /**
   * traderId → cardId → consecutive syncs that did not see it upstream.
   *
   * Rebuilt per trader on every pass, so a terminal that reappears or stops
   * being enabled drops out on its own and the map cannot grow unbounded.
   * In-memory on purpose: a restart resets the counters, which only ever delays
   * a deactivation — the safe direction.
   */
  private readonly missedPasses = new Map<number, Map<number, number>>()

  private readonly testTerminalIds: number[] =
    environments.TEST_TERMINAL_IDS?.split(',').map(Number) ?? []

  constructor(
    private readonly traderDbService: TraderDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly terminalDbService: TerminalDbService,
    // Standing a terminal down is one thing done in one place; this service
    // only decides *when*. It used to write Mongo and clear Redis itself, which
    // is how three copies of the teardown came to disagree.
    private readonly deactivation: TerminalDeactivationService,
    private readonly broadcast: TerminalBroadcastService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncTerminals(): Promise<void> {
    if (this.isSyncing) {
      this.logger.debug('Terminals sync already in progress, skipping')
      return
    }

    this.isSyncing = true
    try {
      const traders = await this.traderDbService.findAllActive()
      if (traders.length === 0) {
        this.logger.debug('No active traders found for terminals sync')
        return
      }

      this.logger.log(`Syncing terminals for ${traders.length} active trader(s)`)

      // Started 50ms apart rather than all in one tick — see `settleStaggered`.
      // Still concurrent: a slow trader delays nobody.
      const results = await settleStaggered(
        traders,
        TRADER_REQUEST_STAGGER_MS,
        async (trader) => {
          // Stamped before the read, not after: everything the response can
          // possibly contain already existed by this instant, so a local row
          // created later is new rather than deleted. `deactivateRemovedTerminals`
          // needs that distinction — see the grace check there.
          const observedAt = Date.now()

          const terminals = await this.transactoApiService.getTerminalsList(trader.apiToken)
          const validCreds = terminals.filter((terminal) =>
            Object.values(BANK_URL_KEYWORDS).some((keyword) => terminal.cred3?.includes(keyword))
          )

          await this.syncTraderTerminals(trader.traderId, validCreds)
          // Deliberately handed the FULL list, not `validCreds`: a terminal
          // whose cred3 is not a bank URL still exists upstream, and judging it
          // against the filtered list would read it as deleted every minute.
          await this.deactivateRemovedTerminals(trader.traderId, terminals, observedAt)

          this.logger.debug(`Synced ${validCreds.length} terminals for trader ${trader.traderId}`)
        }
      )

      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        // Summarised, never the raw rejections: an AxiosError carries the
        // request headers, and every Transacto call sends `X-API-TOKEN` — so
        // this used to print a live trader credential on any upstream 5xx.
        this.logger.error(
          `Terminals sync failed for ${failed.length}/${traders.length} trader(s): ` +
            describeErrors(failed.map((r) => (r as PromiseRejectedResult).reason))
        )
      }
    } catch (error) {
      this.logger.error(
        'Terminals sync cron failed',
        error instanceof Error ? error.stack : String(error)
      )
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Stands down local terminals that no longer exist on Transacto.
   *
   * Deactivated, never deleted: the row is what `terminal_history`, tracked
   * orders and every past alert are read back through, so removing it would
   * erase the history of a terminal that really did handle money. Disabling it
   * takes it out of the watchdog's `{ enabled: true }` query, which is what
   * actually stops the polling.
   *
   * Three guards stand between a bad read and a mass outage, because every one
   * of them has a failure this method cannot otherwise distinguish from a
   * deletion:
   *
   * 1. **The empty list.** `getTerminalsList` ends in `response.data?.credentials
   *    ?? []`, so an auth failure, a schema change or any unexpected body shape
   *    produces an empty array. A trader who genuinely has no terminals has
   *    nothing to deactivate anyway, so refusing to act costs nothing.
   * 2. **The creation grace window.** A sale writes its terminal row
   *    directly — enabled, and correct — the moment Transacto hands back the
   *    credential. If that happened after this pass took its snapshot, the row
   *    is legitimately absent from a list fetched before it existed, and
   *    deactivating it kills a jar seconds after the user was told it was ready.
   *    This is the bug that made Mini App terminals switch themselves off within
   *    a minute of creation.
   * 3. **{@link TerminalSyncGuard.MISSING_PASSES_BEFORE_DEACTIVATION} and
   *    {@link MAX_DEACTIVATION_SHARE}.** A terminal has to be missing from
   *    several consecutive reads, and a single pass may never take down most of
   *    a trader's estate. Together they turn a truncated or partial
   *    `credentials_list` into a loud log line instead of an outage.
   */
  private async deactivateRemovedTerminals(
    traderId: number,
    upstreamTerminals: TransactoTerminal[],
    observedAt: number
  ): Promise<void> {
    if (upstreamTerminals.length === 0) {
      this.missedPasses.delete(traderId)
      this.logger.debug(
        `Transacto returned no terminals for trader ${traderId}; skipping deactivation rather than ` +
          `treating an empty list as every terminal having been deleted`
      )
      return
    }

    const upstreamCardIds = new Set(upstreamTerminals.map((terminal) => terminal.card_id))
    const active = await this.terminalDbService.find({ traderId, enabled: true })

    // A row written after this pass read Transacto is legitimately absent from
    // a list fetched before it existed. Dropping it here rather than counting a
    // miss is the whole of guard 2 — without it a sale's terminal is
    // stood down within a minute of the user being told it was ready.
    const missing = active.filter(
      (terminal) =>
        !upstreamCardIds.has(terminal.cardId) && !this.isNewerThanSnapshot(terminal, observedAt)
    )

    const previous = this.missedPasses.get(traderId)
    const streaks = new Map(
      missing.map((terminal) => [terminal.cardId, (previous?.get(terminal.cardId) ?? 0) + 1])
    )

    const { MISSING_PASSES_BEFORE_DEACTIVATION, MAX_DEACTIVATION_SHARE, MIN_MASS_DEACTIVATION } =
      TerminalSyncGuard

    // Rebuilt rather than mutated, and holding only the terminals still under
    // observation: anything that reappeared, was deactivated, or stopped being
    // enabled is simply not in the new map, which both resets its streak and
    // prunes the entry.
    const pending = new Map(
      [...streaks].filter(([, streak]) => streak < MISSING_PASSES_BEFORE_DEACTIVATION)
    )
    if (pending.size > 0) this.missedPasses.set(traderId, pending)
    else this.missedPasses.delete(traderId)

    for (const [cardId, streak] of pending)
      this.logger.debug(
        `Terminal card_id ${cardId} for trader ${traderId} missing from Transacto ` +
          `(${streak}/${MISSING_PASSES_BEFORE_DEACTIVATION}); waiting for confirmation`
      )

    const removed = missing.filter(
      (terminal) => (streaks.get(terminal.cardId) ?? 0) >= MISSING_PASSES_BEFORE_DEACTIVATION
    )
    if (removed.length === 0) return

    if (
      removed.length >= MIN_MASS_DEACTIVATION &&
      removed.length > active.length * MAX_DEACTIVATION_SHARE
    ) {
      this.logger.error(
        `Refusing to deactivate ${removed.length} of trader ${traderId}'s ${active.length} active ` +
          `terminal(s) in one pass. Transacto has consistently stopped listing them, which at this ` +
          `scale is far more likely to be a truncated or partial credentials_list than a real ` +
          `deletion. Investigate before any of these are stood down.`
      )
      return
    }

    for (const terminal of removed) {
      this.logger.warn(
        `Terminal ${terminal.terminalId} (card_id ${terminal.cardId}) has been absent from ` +
          `Transacto for ${MISSING_PASSES_BEFORE_DEACTIVATION} consecutive syncs for trader ` +
          `${traderId}. Deactivating and clearing its cached state; history is kept.`
      )

      // No `apiToken`, and that is the one intentional difference between the
      // three teardowns: this credential has vanished from `credentials_list`,
      // so there is nothing left upstream to switch off or archive. Everything
      // else — the alert, Mongo, then Redis, in that order — is the shared path.
      await this.deactivation.deactivate({
        terminalId: terminal.terminalId,
        traderId,
        cardId: terminal.cardId,
        reason: `Removed from Transacto for ${MISSING_PASSES_BEFORE_DEACTIVATION} syncs`
      })
    }

    this.logger.log(
      `Deactivated ${removed.length} terminal(s) removed from Transacto for trader ${traderId}`
    )
  }

  /**
   * True when the row was written after this pass read Transacto.
   *
   * A row with no `createdAt` predates `timestamps` being readable here and is
   * treated as old, which is the conservative answer: it only ever removes the
   * grace period from a terminal that has existed long enough to have one.
   */
  private isNewerThanSnapshot(terminal: TerminalDoc, observedAt: number): boolean {
    if (!terminal.createdAt) return false
    return new Date(terminal.createdAt).getTime() > observedAt
  }

  private async syncTraderTerminals(traderId: number, terminals: TransactoTerminal[]): Promise<void> {
    if (!terminals || terminals.length === 0) return

    // One read for the whole trader. This used to be a `findOne` per terminal,
    // awaited in sequence and used only to pick a log line — so a trader with
    // forty terminals spent forty round trips here, and every one of them
    // widened the window between the upstream snapshot and the deletion check
    // that reads it.
    const existing = await this.terminalDbService.find({ traderId })
    const byCardId = new Map(existing.map((terminal) => [terminal.cardId, terminal]))

    // Cards that will be live after this pass and were not before — either
    // brand new, or switched back on upstream. They are what the trader's
    // dashboard has to learn about without waiting for a reload.
    const nowVisible: number[] = []

    const ops = terminals.map((terminal) => {
      const terminalName = terminal.terminal_name ?? 'Unknown'
      const previous = byCardId.get(terminal.card_id)
      const enabled = this.resolveEnabled(terminal, previous)

      this.logEnablementChange(terminal.card_id, previous, enabled)

      // `enabled === null` means upstream said nothing, so nothing changed
      // here either — see `resolveEnabled`.
      if (enabled === true && previous?.enabled !== true) nowVisible.push(terminal.card_id)

      return {
        updateOne: {
          filter: { traderId, cardId: terminal.card_id },
          update: {
            $set: {
              traderId,
              cardId: terminal.card_id,
              terminalId: terminal.terminal_id,
              terminalName,
              cred3: terminal.cred3 ?? null,
              // Written only when upstream actually said something — see
              // `resolveEnabled`.
              ...(enabled === null ? {} : { enabled }),
              // Re-classified on every sync, not only on insert: a Mini App
              // terminal is created through the Transacto API too, so it comes
              // back in this same list and `$setOnInsert` would leave the
              // trader-scoped copy labelled TRANSACTO. This also backfills
              // terminals that predate the field.
              source: classifyTerminalSource(terminalName)
            },
            // A terminal we know nothing about starts off rather than taking
            // the schema's `default: true`. Only reachable when `enabled` is
            // null, so it can never conflict with the `$set` above.
            ...(enabled === null ? { $setOnInsert: { enabled: false } } : {})
          },
          upsert: true
        }
      }
    })

    await this.terminalDbService.bulkWrite(ops)

    await this.announceNewlyVisible(traderId, nowVisible)
  }

  /**
   * Pushes each newly live terminal to the trader's extension.
   *
   * Re-read after the write rather than assembled from the upstream row: the
   * card the client renders is built from *our* document, which carries the
   * last balance and goal we observed — and those are what let it draw a
   * complete card straight away instead of an empty one that fills in when the
   * scraper next runs.
   *
   * Nothing is announced when nothing changed, which is every pass but the few
   * where a terminal actually appears.
   */
  private async announceNewlyVisible(traderId: number, cardIds: number[]): Promise<void> {
    if (!cardIds.length) return

    const written = await this.terminalDbService.find({ traderId, cardId: { $in: cardIds } })

    for (const terminal of written) await this.broadcast.announceEnabled(terminal)

    this.logger.log(
      `Announced ${written.length} newly enabled terminal(s) to trader ${traderId}`
    )
  }

  /**
   * What upstream says this terminal's local `enabled` should be, or `null`
   * when it does not say.
   *
   * `enable_orders` is optional on the response, and it used to be read as
   * `?? false` — so any release where Transacto renamed the field, omitted it
   * for a terminal type, or returned a shape we did not expect would disable
   * every terminal of every trader on the next tick, one minute later. The
   * empty-list guard exists for precisely that class of failure and did not
   * cover this one. `null` means "leave the local row as it is", which is the
   * only honest answer to a response that is silent.
   */
  private resolveEnabled(
    terminal: TransactoTerminal,
    previous: TerminalDoc | undefined
  ): boolean | null {
    if (
      environments.NODE_ENV === NODE_ENV.LOCAL &&
      this.testTerminalIds.includes(terminal.terminal_id)
    )
      return true

    // A terminal winding down is the one case where `enable_orders: 0` upstream
    // is **our own doing** rather than news. `TerminalDeactivationService.stopRouting`
    // sets it so no new payer is routed to a sale the user has asked to
    // end — while deliberately leaving the terminal in service, because a payer
    // already holding an order can still pay and that money has to be seen.
    //
    // Reading the flag back here would disable the local row on the very next
    // pass, a minute later, and stop the scrape that is the entire point of
    // staying in service. The jar would then take a late payment silently, and
    // the sale would refund the whole stake while the user kept the
    // hryvnia.
    // `enabled === true` as well, so the exception cannot outlive the window
    // it is for: a terminal that has since been torn down must stay
    // re-enablable from upstream like any other.
    if (previous?.enabled === true && previous.acceptingOrders === false) return null

    return terminal.enable_orders ?? null
  }

  /** The operator-facing narration of a terminal changing state upstream. */
  private logEnablementChange(
    cardId: number,
    existing: TerminalDoc | undefined,
    enabled: boolean | null
  ): void {
    if (enabled === null) {
      this.logger.debug(
        `Transacto did not report enable_orders for terminal ${cardId}; leaving it as it is`
      )
      return
    }

    if (!existing) {
      if (enabled) this.logger.log(`New terminal ${cardId} discovered. Activating terminal.`)
      return
    }

    if (!enabled && existing.enabled) {
      this.logger.warn(`Terminal ${cardId} is being disabled!`)
      return
    }

    if (enabled && !existing.enabled)
      this.logger.log(`Terminal ${cardId} was re-enabled on Transacto. Reactivating terminal.`)
  }
}
