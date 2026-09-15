import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { FiatDepositWatchService } from 'src/modules/telegram-mini-app/services/fiat-deposit-watch.service'
import {
  TransactoPanelCurrencyId,
  TransactoPanelPayoutRow,
  TransactoPayoutStatus,
  TransactoPayoutType
} from 'src/shared/interfaces/transacto-panel.interface'
import { describeError, panelAmountToKopecks } from 'src/shared/utils'

const CACHE_KEY = 'tma:fiat_book:amounts'

/**
 * Long enough to survive a few failed refreshes, short enough that a book
 * nobody is refreshing goes quiet instead of going stale. The refresh runs
 * every twenty seconds, so this is six missed ticks.
 *
 * Six *missed* ticks, not six ticks: every tick that reaches the panel renews
 * it, including the cheap ones that only read the count. The window is
 * therefore how long the panel may be unreachable before the offer is withdrawn
 * — and nothing else.
 */
const CACHE_TTL_SECONDS = 120

/**
 * How long the count may be trusted before the table is re-read anyway.
 *
 * The count is a good enough answer to "has the book changed" for the offer,
 * and not good enough for the announcements: one payout taken and one added
 * between two ticks leaves the count identical, so the fast path would show a
 * sum that is gone and stay silent about the one that arrived. A forced read
 * every two minutes bounds that to two minutes, at a cost of eleven kilobytes
 * on the quiet nights the fast path exists for — which is cheaper than the fast
 * path was ever worth.
 */
const MAX_TRUSTED_COUNT_AGE_MS = 2 * 60 * 1000

/**
 * Which amounts a Mini App user can pick, kept fresh from Transacto's open
 * book.
 *
 * A payout in that book is one somebody else's card is waiting on, and taking
 * one is a commitment. So this service does two separate jobs and keeps them
 * apart on purpose:
 *
 * - **The offer** is a cached snapshot, refreshed every twenty seconds. It is
 *   allowed to be a little stale, because it is a list of prices on a screen.
 * - **The candidates** are read live, at the moment somebody reserves. Nothing
 *   is ever assigned off the snapshot: twenty seconds is several lifetimes for
 *   a row in this book, and reserving a payout another trader already took is
 *   the one mistake here that reaches a stranger's money.
 *
 * The refresh is cheap because the panel publishes a count. Eleven kilobytes of
 * HTML are only fetched when that number moves — which, on a quiet night, is
 * almost never.
 */
@Injectable()
export class FiatDepositBookService {
  private readonly logger = new Logger(FiatDepositBookService.name)

  /**
   * The count at the last successful refresh, or `null` when there has not
   * been one.
   *
   * Per-instance rather than in Redis, and deliberately so: it guards *this*
   * process's fetch, and a shared value would let one replica's refresh
   * convince another that it already has a snapshot it has never seen.
   *
   * **This tick now also sends messages, so a second replica is no longer free.**
   * Two instances would each diff the book against their own baseline and each
   * emit, and a user waiting on an amount would be told about it twice. The API
   * runs as a single container today (`docker-compose.yml` declares no
   * replicas); scaling it out means giving this pass a lease before it does,
   * not merely accepting a duplicated fetch.
   */
  private lastCount: number | null = null

  /**
   * When the table itself was last read, as epoch milliseconds.
   *
   * Zero means never, which is why this is a comparison against
   * {@link MAX_TRUSTED_COUNT_AGE_MS} rather than a null check: an instance that
   * has not fetched yet must fetch, and `0` already says so.
   */
  private lastFetchAtMs = 0

  /**
   * Whether a tick is still running.
   *
   * Nest's scheduler does not skip an overlapping run, and a panel call walks
   * up to `PROXY_ATTEMPTS` addresses — comfortably past twenty seconds on a bad
   * pool. Two runs would both read the baseline before either wrote it, both
   * see the same arrivals, and both announce them: one sum, two messages to the
   * same person. That was harmless while this tick only refreshed a cache.
   *
   * A field rather than a Redis lease because it guards *this* process, exactly
   * as `lastCount` does; a second replica needs the lease, and needs it for the
   * same reason.
   */
  private running = false

  constructor(
    private readonly panelPayouts: TransactoPanelPayoutsApiService,
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly watches: FiatDepositWatchService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * Re-reads the book, skipping the table when the count has not moved.
   *
   * **Skipping the fetch is not skipping the tick.** An unmoved count is a
   * positive answer from the panel — the book is still what the snapshot says
   * — so the snapshot's life is renewed on the way past. It used to be left
   * alone, and a book whose count sat still for two minutes (a quiet night, the
   * case this fast path exists for) expired underneath the screen: `getOptions`
   * reads an absent key as an empty offer, so every user on the amounts list
   * watched it empty out for the ~20s until the next tick found the key gone
   * and refetched, then fill again, every two minutes.
   *
   * Renewing on the count read is also what makes the TTL mean one thing: the
   * offer is withdrawn when the panel cannot be reached, and never merely
   * because it had nothing new to say.
   *
   * **The fast path is bounded in time as well as by the count**, because this
   * tick now feeds the announcements too — see {@link MAX_TRUSTED_COUNT_AGE_MS}
   * for the swap it would otherwise miss.
   *
   * Never throws. A cron that throws logs a stack trace nobody reads and stops
   * nothing else; the visible consequence of a failed refresh is the snapshot
   * ageing out, which is exactly what should happen when the panel cannot be
   * reached. {@link FiatDepositWatchService.announce} holds to the same rule,
   * so nobody's offer goes stale because one person's notification could not be
   * worked out.
   */
  @Cron('*/20 * * * * *')
  async refresh(): Promise<void> {
    if (this.running) {
      this.logger.warn('Fiat book refresh is still running; skipping this tick')

      return
    }

    this.running = true

    try {
      const count = await this.panelPayouts.getOpenPayoutsCount()
      // `expire` answers 0 when there is no key to renew, which folds the
      // "have we got a snapshot at all" check into the same round trip.
      if (this.canTrustCount(count) && (await this.redis.expire(CACHE_KEY, CACHE_TTL_SECONDS)) === 1)
        return

      // Read before the write, because the difference between the two is what
      // anybody waiting on an amount is told about. `null` is a cold start —
      // this instance has no baseline, so every amount would look new and
      // everybody watching would be told the whole book had just arrived.
      const previous = await this.readSnapshot()

      const { rows, unreadable } = await this.panelPayouts.getNewPayouts()

      // A table we could only half read is not a smaller book, and writing it
      // as one is paid for twice: the offer loses amounts that are still there,
      // and the *next* clean tick diffs against the truncated baseline and
      // announces every one of them as a fresh arrival. `panel-table.util.ts`
      // counts what it could not parse precisely so this decision can be made;
      // `sweepReviews` refuses on the same evidence for the same reason.
      if (unreadable > 0) {
        this.logger.error(
          `${unreadable} payout row(s) could not be read from the panel; keeping the previous ` +
            'offer and announcing nothing — a half-read table and a smaller book look alike'
        )

        return
      }

      const amounts = this.offeredAmounts(rows)

      await this.redis.set(CACHE_KEY, JSON.stringify(amounts), 'EX', CACHE_TTL_SECONDS)
      this.lastCount = count
      this.lastFetchAtMs = Date.now()

      this.logger.debug(`Fiat book refreshed: ${amounts.length} amount(s) from ${count} payout(s)`)

      if (previous !== null)
        await this.watches.announce(amounts.filter((amount) => !previous.includes(amount)))
    } catch (error: unknown) {
      // The snapshot is left to expire rather than cleared. A passing outage
      // should not empty a screen that was correct a moment ago, and a real one
      // empties it within two minutes anyway.
      this.lastCount = null
      this.logger.error(`Fiat book refresh failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /**
   * The offer and whether it is one at all, from a **single** read.
   *
   * Two calls would be two reads of a key that expires on its own clock, and
   * the pair could straddle the expiry: a non-empty list beside "the book could
   * not be read", or an empty one beside "the book is fine". Those are exactly
   * the two sentences the flag exists to keep apart, so they cannot come from
   * two round trips.
   */
  async readOffer(): Promise<{ amountsUah: number[]; available: boolean }> {
    const snapshot = await this.readSnapshot()

    return { amountsUah: snapshot ?? [], available: snapshot !== null }
  }

  /**
   * The snapshot, or `null` when there is not one this instance can trust.
   *
   * The distinction {@link readOffer} hands on to its caller: for a screen
   * "nothing on offer" and "no snapshot" render as the same empty list, and for
   * the announcement pass they are opposites — one is a book that emptied,
   * the other is a baseline that does not exist, against which every amount in
   * the book looks new.
   *
   * **A value that will not parse, or parses to something that is not a list,
   * is `null` too** — not an empty offer. Reading it as one would tell the
   * announcement pass that the book had just gained everything in it, and every
   * user waiting on an amount would hear about all of them at once.
   */
  private async readSnapshot(): Promise<number[] | null> {
    try {
      const cached = await this.redis.get(CACHE_KEY)
      if (cached === null) return null

      const parsed: unknown = JSON.parse(cached)

      // Every element, or none of them. Filtering the strays out would answer
      // with a *shorter* list that still looks like a snapshot — the truncated
      // baseline of the paragraph above, arrived at from the other direction.
      return Array.isArray(parsed) && parsed.every((value) => typeof value === 'number')
        ? (parsed as number[])
        : null
    } catch (error: unknown) {
      // The read itself can fail too, and this one is on the request path: an
      // unreachable Redis must answer "we could not read the book", which is a
      // sentence this product now has, rather than failing the whole screen.
      this.logger.error(`Fiat book snapshot could not be read: ${describeError(error)}`)

      return null
    }
  }

  /**
   * Whether the table may be skipped this tick.
   *
   * Two conditions, not one: the count has to be unchanged *and* the last real
   * read has to be recent. See {@link MAX_TRUSTED_COUNT_AGE_MS} for what the
   * second one is protecting against.
   */
  private canTrustCount(count: number): boolean {
    return count === this.lastCount && Date.now() - this.lastFetchAtMs < MAX_TRUSTED_COUNT_AGE_MS
  }

  /**
   * Payouts that could settle this amount right now, oldest first.
   *
   * Read live, never from the snapshot. Oldest first because a payout that has
   * waited longest is the one Transacto most wants off its books — and because
   * every trader's panel sorts by something else, which makes the oldest row
   * the least contended.
   *
   * Payouts already held here are excluded even though a held payout should
   * have left the open book on its own. It costs one indexed query, and the
   * case it covers — an assignment that succeeded upstream while the answer
   * never reached us — is precisely the one where the book would otherwise
   * offer a user a payout that is already somebody's.
   */
  async findCandidates(amountUah: number): Promise<TransactoPanelPayoutRow[]> {
    const [{ rows }, heldPayoutIds] = await Promise.all([
      this.panelPayouts.getNewPayouts(),
      this.fiatDepositDb.findHeldPayoutIds()
    ])

    const held = new Set(heldPayoutIds)

    return rows
      .filter((row) => this.isOfferable(row))
      .filter((row) => panelAmountToKopecks(row.amount) === amountUah)
      .filter((row) => !held.has(row.id))
      .toSorted((left, right) => left.created_at.localeCompare(right.created_at))
  }

  /**
   * Distinct amounts, cheapest first.
   *
   * Distinct because the user picks a *sum*, not a row: two payouts of ₴2 940
   * are one choice on the screen, and which of them settles it is a detail of
   * the reservation.
   */
  private offeredAmounts(rows: readonly TransactoPanelPayoutRow[]): number[] {
    const amounts = rows
      .filter((row) => this.isOfferable(row))
      .map((row) => panelAmountToKopecks(row.amount))
      .filter((amount): amount is number => amount !== null && amount > 0)

    return [...new Set(amounts)].toSorted((left, right) => left - right)
  }

  /**
   * Whether a payout is one a Mini App user could settle.
   *
   * Hryvnia and a card, and nothing else. The panel serves five currencies and
   * three destination types; an SBP transfer or a rouble payout is somebody
   * else's product, and a user shown one could not pay it from a Ukrainian
   * bank if they tried.
   */
  private isOfferable(row: TransactoPanelPayoutRow): boolean {
    return (
      row.status === TransactoPayoutStatus.NEW &&
      row.type === TransactoPayoutType.CARD &&
      row.currency_id === TransactoPanelCurrencyId.UAH
    )
  }
}
