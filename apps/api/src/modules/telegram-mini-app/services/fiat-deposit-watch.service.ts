import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ERROR,
  MIN_USDT_CENTS,
  topUpCreditCents,
  type FiatDepositWatch,
  type SaveFiatDepositWatchReq
} from '@transacto/contracts'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TmaFiatDepositWatchDbService } from 'src/modules/repositories/tma-fiat-deposit-watch-db/services'
import { FiatDepositCeilingService } from 'src/modules/telegram-mini-app/services/fiat-deposit-ceiling.service'
import { toFiatDepositWatchContract } from 'src/modules/telegram-mini-app/utils'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaFiatDepositAmountsAvailableEvent } from 'src/shared/interfaces'
import type { TmaFiatDepositWatchRecord } from 'src/modules/repositories/tma-fiat-deposit-watch-db/interfaces'
import { describeError } from 'src/shared/utils'

/**
 * How many requests are matched at a time.
 *
 * Each one costs three indexed reads, and they all run inside the
 * twenty-second tick that also keeps every user's offer alive. Unbounded
 * `Promise.all` over a growing collection turns one book movement into a
 * thousand simultaneous queries; a chunk keeps the concurrency flat without
 * dropping anybody, which a `limit` on the query would do silently.
 */
const MATCH_CHUNK_SIZE = 25

/**
 * Standing requests to be told when a usable sum reaches Transacto's book.
 *
 * The book is other traders' payouts and nobody here decides what is in it, so
 * a user who needs ₴7 000 on a night that offers ₴300 and ₴42 000 has nothing
 * to do but keep re-opening a screen. This is the alternative: they leave a
 * range, and the refresh that already reads the book every twenty seconds calls
 * them when one arrives.
 *
 * Two properties carry the whole design:
 *
 * - **It fires on arrivals, not on presence.** {@link announce} is handed the
 *   amounts that appeared on *this* tick, so a sum sitting in the book for an
 *   hour is one message rather than a hundred and eighty. Nothing here throttles
 *   anything, because there is nothing to throttle.
 * - **It never tells anybody about a sum they could not take.** A user already
 *   holding a top-up is skipped, and amounts above their first-deposit ceiling
 *   are filtered out — a notification the product would refuse to honour is
 *   worse than silence.
 *
 * The message itself is somebody else's job: this emits a neutral event. The
 * Mini App module must not know a Telegram bot exists, and the book refresh must
 * not be able to fail because Telegram was slow.
 */
@Injectable()
export class FiatDepositWatchService {
  private readonly logger = new Logger(FiatDepositWatchService.name)

  constructor(
    private readonly watchDb: TmaFiatDepositWatchDbService,
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly ceiling: FiatDepositCeilingService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly events: EventEmitter2
  ) {}

  async getFor(telegramId: number): Promise<FiatDepositWatch | null> {
    const record = await this.watchDb.findByTelegramId(telegramId)

    return record === null ? null : toFiatDepositWatchContract(record)
  }

  /**
   * Records the range, replacing whatever the user asked for before.
   *
   * Both refusals here are refusals of a request that could never fire, and
   * both are refusals rather than adjustments. A range quietly narrowed to
   * something the product can serve is a range the user believes they asked for
   * and did not — and they would find out by never being called.
   */
  async save(telegramId: number, req: SaveFiatDepositWatchReq): Promise<FiatDepositWatch> {
    const { minAmountUah, maxAmountUah, mode } = req

    if (maxAmountUah < minAmountUah)
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.WATCH_RANGE_INVALID)

    // The floor is the product's, not the panel's: an amount that buys less
    // than the minimum USDT is dropped from the offer, so a range entirely
    // below it describes sums this screen would never list even when the book
    // is full of them.
    const rate = await this.exchangeRate.getBuyRate()
    if (!this.isOfferable(maxAmountUah, rate))
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.WATCH_RANGE_INVALID)

    const maxAllowed = await this.ceiling.forUser(telegramId)
    if (!this.ceiling.isWithin(minAmountUah, maxAllowed))
      throw new BadRequestException(ERROR.FIAT_DEPOSIT.WATCH_ABOVE_FIRST_DEPOSIT_LIMIT)

    const saved = await this.watchDb.save(telegramId, { minAmountUah, maxAmountUah, mode })

    return toFiatDepositWatchContract(saved)
  }

  async remove(telegramId: number): Promise<void> {
    await this.watchDb.removeByTelegramId(telegramId)
  }

  /**
   * Tells whoever asked that one of these amounts has just reached the book.
   *
   * Called from the book refresh with the amounts that were **not** on the
   * previous snapshot, which is what makes one arrival one message.
   *
   * **Never throws.** It runs inside the cron that keeps the offer alive for
   * everybody, and a request that cannot be matched must not be able to stop
   * the screen refreshing for users who are not waiting on anything.
   */
  async announce(appearedAmountsUah: readonly number[]): Promise<void> {
    if (appearedAmountsUah.length === 0) return

    try {
      // Read once for the whole pass rather than per request: it is the same
      // rate for everybody on this tick, and asking per candidate would let two
      // users be judged against two different prices for the same payout.
      const rate = await this.exchangeRate.getBuyRate()
      const offerable = appearedAmountsUah.filter((amount) => this.isOfferable(amount, rate))
      if (offerable.length === 0) return

      const candidates = await this.watchDb.findOverlapping(offerable)

      for (let from = 0; from < candidates.length; from += MATCH_CHUNK_SIZE) {
        const chunk = candidates.slice(from, from + MATCH_CHUNK_SIZE)

        const matches = await Promise.all(
          chunk.map(async (watch) => ({
            watch,
            amountsUah: await this.matchesFor(watch, offerable)
          }))
        )

        for (const { watch, amountsUah } of matches) {
          if (amountsUah.length === 0) continue

          const event: TmaFiatDepositAmountsAvailableEvent = {
            watchId: watch._id.toString(),
            telegramId: watch.telegramId,
            amountsUah,
            minAmountUah: watch.minAmountUah,
            maxAmountUah: watch.maxAmountUah,
            mode: watch.mode
          }

          this.events.emit(TMA_DOMAIN_EVENT.FIAT_DEPOSIT_AMOUNTS_AVAILABLE, event)
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Could not announce new fiat amounts: ${describeError(error)}`)
    }
  }

  /**
   * Whether an amount is one the top-up screen would actually list.
   *
   * The same floor `getOptions` applies, and applied **here rather than when
   * the request was saved**, because the rate moves and the floor moves with
   * it. Saving only proves the range's *top* clears the floor; a range of
   * ₴1–₴3 000 is legitimate and would otherwise fire on a ₴300 payout that the
   * list drops and `reserve` refuses — a message pointing at a screen showing
   * nothing.
   */
  private isOfferable(amountUah: number, rate: number): boolean {
    return topUpCreditCents(amountUah, rate) >= MIN_USDT_CENTS
  }

  /**
   * The amounts this particular user should hear about, cheapest first.
   *
   * Empty for three different reasons, and the caller treats all three the
   * same: none of the new amounts is in their range, they are already holding a
   * top-up and could not reserve a second, or every match sits above the
   * ceiling their account has not yet lifted.
   */
  private async matchesFor(
    watch: TmaFiatDepositWatchRecord,
    appearedAmountsUah: readonly number[]
  ): Promise<number[]> {
    const inRange = appearedAmountsUah
      .filter((amount) => amount >= watch.minAmountUah && amount <= watch.maxAmountUah)
      .toSorted((left, right) => left - right)

    if (inRange.length === 0) return []

    const [active, maxAllowed] = await Promise.all([
      this.fiatDepositDb.findActiveByTelegramId(watch.telegramId),
      this.ceiling.forUser(watch.telegramId)
    ])

    if (active !== null) return []

    return inRange.filter((amount) => this.ceiling.isWithin(amount, maxAllowed))
  }
}
