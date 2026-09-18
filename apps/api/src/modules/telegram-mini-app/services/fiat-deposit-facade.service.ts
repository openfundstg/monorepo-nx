import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException
} from '@nestjs/common'
import {
  CentRounding,
  ERROR,
  isFiatDepositPayable,
  MIN_USDT_CENTS,
  usdtCentsForKopecks,
  TmaFiatDepositStatus,
  type FiatDepositOptionsResponse,
  type TmaFiatDeposit
} from '@transacto/contracts'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import { FiatDepositBookService } from 'src/modules/telegram-mini-app/services/fiat-deposit-book.service'
import { FiatDepositCeilingService } from 'src/modules/telegram-mini-app/services/fiat-deposit-ceiling.service'
import { FiatDepositWatchService } from 'src/modules/telegram-mini-app/services/fiat-deposit-watch.service'
import { FiatDepositSettlementService } from 'src/modules/telegram-mini-app/services/fiat-deposit-settlement.service'
import {
  assertOwnedFiatDeposit,
  toFiatDepositContract
} from 'src/modules/telegram-mini-app/utils'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import type { TransactoPanelPayoutRow } from 'src/shared/interfaces/transacto-panel.interface'
import { describeError, ensure, isDuplicateKeyOn } from 'src/shared/utils'
import { MINUTE_MS } from 'src/shared/constants'
import environments from 'src/environments'


/** What the panel answers when an action worked. Its only success value. */
const PANEL_OK = 'ok'

/**
 * How many payouts a single reservation will try to take before giving up.
 *
 * More than one because losing a race is the ordinary case here — traders share
 * this book and a row can go between reading it and taking it — and few,
 * because each attempt is a round trip a user is waiting through. Three covers
 * a contested amount without turning a busy book into a slow screen.
 */
const MAX_RESERVATION_ATTEMPTS = 3

/**
 * Topping up by settling somebody else's payout.
 *
 * The user picks an amount, we take a matching payout out of Transacto's book
 * in their name, and they transfer that exact sum from their own card to the
 * recipient's. Their hryvnia never touches an account of ours — what we hand
 * back is USDT, at the rate frozen the moment they reserved.
 *
 * The rules this file exists to hold, all of which cost somebody real money if
 * they slip:
 *
 * - **A payout is taken live or not at all.** Candidates come from a fresh read
 *   of the book, never from the cached offer.
 * - **One live top-up per user**, enforced by a unique index rather than by the
 *   check below it. The check is a courtesy that avoids taking a payout we
 *   would then have to give back; the index is the guarantee.
 * - **A payout we took and could not record is given straight back.** The
 *   alternative is a payout held in a stranger's name that no user can see and
 *   no timer will release.
 * - **Nothing here credits a balance.** Crediting happens when Transacto
 *   reports the payout executed, which is not something a user's tap can cause.
 */
@Injectable()
export class FiatDepositFacadeService {
  private readonly logger = new Logger(FiatDepositFacadeService.name)

  constructor(
    private readonly book: FiatDepositBookService,
    private readonly panelPayouts: TransactoPanelPayoutsApiService,
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly ceiling: FiatDepositCeilingService,
    private readonly watches: FiatDepositWatchService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly settlement: FiatDepositSettlementService
  ) {}

  /**
   * Minutes the user is shown to pay in, and now the deadline for a receipt as
   * well: uploads are refused once it passes, and what is left is an appeal.
   *
   * Fifteen rather than ten because the window has to cover the whole errand —
   * open a banking app, transfer to the kopeck, export the receipt, upload it —
   * and ten minutes was being spent on the transfer alone.
   */
  get payWindowMinutes(): number {
    return Number(environments.TMA_FIAT_PAY_WINDOW_MINUTES || '15')
  }

  /**
   * Minutes the payout is actually held for — longer than the visible window.
   *
   * Somebody who pays at the last second still has to open their bank, export
   * the receipt and upload it. Releasing on the visible deadline would hand the
   * payout to another trader while their money was already on its way to it.
   */
  get holdMinutes(): number {
    return Number(environments.TMA_FIAT_HOLD_MINUTES || '30')
  }

  /**
   * The amounts on offer, priced at this product's own rate.
   *
   * Two filters, for two different reasons. Amounts whose USDT falls below the
   * product's floor are dropped because the fixed cost of a transfer outweighs
   * them — as true of a hryvnia transfer as of a chain one. Amounts above a
   * new account's ceiling are dropped because nothing yet says this user has
   * ever moved their own money through the product, and `maxAmountUah` rides
   * along so the screen can say so rather than showing a short list with no
   * explanation.
   */
  async getOptions(telegramId: number): Promise<FiatDepositOptionsResponse> {
    // One read for the offer and its availability, never two: the snapshot
    // expires on its own clock, and a pair of reads could straddle that —
    // producing amounts beside "we could not read the book", which is the exact
    // confusion `bookAvailable` was added to end.
    const [offer, active, exchangeRate, maxAmountUah, watch] = await Promise.all([
      this.book.readOffer(),
      this.fiatDepositDb.findActiveByTelegramId(telegramId),
      this.exchangeRate.getBuyRate(),
      this.ceiling.forUser(telegramId),
      this.watches.getFor(telegramId)
    ])

    const options = offer.amountsUah
      .filter((amountUah) => this.ceiling.isWithin(amountUah, maxAmountUah))
      .map((amountUah) => ({ amountUah, cryptoCents: this.creditFor(amountUah, exchangeRate) }))
      .filter(({ cryptoCents }) => cryptoCents >= MIN_USDT_CENTS)

    return {
      options,
      exchangeRate,
      maxAmountUah,
      payWindowMinutes: this.payWindowMinutes,
      bookAvailable: offer.available,
      watch,
      activeDepositId: active === null ? null : active._id.toString()
    }
  }

  /**
   * What a hryvnia amount buys, in USDT cents.
   *
   * **Rounded down**, and through the same converter every other product uses
   * — a sale's refund and a top-up's credit are the same arithmetic
   * over the same units, and a second implementation of it here would be a
   * second answer to "what is ₴1 706 worth". The direction is the argument:
   * rounding a fraction of a cent up credits USDT nobody paid for, on every
   * top-up, forever.
   */
  private creditFor(amountUah: number, exchangeRate: number): number {
    return usdtCentsForKopecks(amountUah, exchangeRate, CentRounding.DOWN)
  }

  /** The user's live top-up, or `null`. */
  async getActive(telegramId: number): Promise<TmaFiatDeposit | null> {
    const active = await this.fiatDepositDb.findActiveByTelegramId(telegramId)

    return active === null ? null : toFiatDepositContract(active)
  }

  async getById(telegramId: number, depositId: string): Promise<TmaFiatDeposit> {
    return toFiatDepositContract(await this.requireOwned(telegramId, depositId))
  }

  /** Everything this user has ever topped up with, newest first. */
  async list(telegramId: number, limit = 20): Promise<TmaFiatDeposit[]> {
    const records = await this.fiatDepositDb.findByTelegramId(telegramId, limit)

    return records.map(toFiatDepositContract)
  }

  /**
   * Takes a payout carrying this amount and puts it in the user's name.
   *
   * The rate is read *before* the payout is taken. Doing it the other way round
   * would leave a payout assigned to a user while an outage in the rate service
   * decided whether they ever saw it.
   */
  async reserve(telegramId: number, amountUah: number): Promise<TmaFiatDeposit> {
    const active = await this.fiatDepositDb.findActiveByTelegramId(telegramId)
    if (active !== null) throw new ConflictException(ERROR.FIAT_DEPOSIT.ALREADY_ACTIVE)

    // Checked here as well as filtered out of the offer, because the offer is a
    // courtesy and this is the rule: a stale screen still holds yesterday's
    // list, and a request is a request whatever drew the button.
    const maxAmountUah = await this.ceiling.forUser(telegramId)

    if (!this.ceiling.isWithin(amountUah, maxAmountUah)) {
      throw new BadRequestException({
        ...ERROR.FIAT_DEPOSIT.ABOVE_FIRST_DEPOSIT_LIMIT,
        details:
          `${amountUah} kopecks is above the ceiling of ${String(maxAmountUah)} ` +
          'that stands until this account has one credited deposit'
      })
    }

    const exchangeRate = await this.exchangeRate.getBuyRate()
    const cryptoCents = this.creditFor(amountUah, exchangeRate)

    if (cryptoCents < MIN_USDT_CENTS) {
      throw new BadRequestException({
        ...ERROR.DEPOSIT.BELOW_MINIMUM,
        details: `${amountUah} kopecks is ${cryptoCents} USDT cents at ${exchangeRate}`
      })
    }

    const candidates = await this.candidatesFor(amountUah)

    for (const candidate of candidates.slice(0, MAX_RESERVATION_ATTEMPTS)) {
      const reserved = await this.claim(telegramId, candidate, {
        amountUah,
        exchangeRate,
        cryptoCents
      })
      if (reserved !== null) return reserved
    }

    throw new ConflictException(ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE)
  }

  /**
   * Hands a top-up to an operator at the user's request.
   *
   * The way out of the one state the product cannot resolve on its own: the pay
   * window has closed, so no receipt will be taken, and the user says they paid
   * anyway. The payout deliberately stays ours — see
   * {@link FiatDepositSettlementService.review} — because releasing one
   * somebody has already paid into is the mistake that costs them their money.
   *
   * Refused once the top-up is no longer live: an expired or cancelled one has
   * already given its payout back, and there is nothing left here for an
   * operator to act on. Support is still reachable from the bot.
   */
  async appeal(telegramId: number, depositId: string): Promise<TmaFiatDeposit> {
    const record = await this.requireOwned(telegramId, depositId)

    if (!isFiatDepositPayable(record.status))
      throw new ConflictException(ERROR.FIAT_DEPOSIT.NOT_PAYABLE)

    const flagged = ensure(
      await this.settlement.review(record),
      new ConflictException(ERROR.FIAT_DEPOSIT.NOT_PAYABLE)
    )

    this.logger.warn(
      `[fiat ${depositId}] telegramId ${telegramId} appealed after the pay window closed`
    )

    return toFiatDepositContract(flagged)
  }

  /**
   * Gives the payout back at the user's request.
   *
   * Refused once anything has been accepted against it. A user cancelling a
   * top-up they have already paid part of is not cancelling anything — the
   * money is gone from their card — and releasing the payout then would hand a
   * stranger the rest of a transfer that is already half made. That case is an
   * operator's, and the hold expiry routes it to one.
   */
  async cancel(telegramId: number, depositId: string): Promise<TmaFiatDeposit> {
    const record = await this.requireOwned(telegramId, depositId)

    if (!isFiatDepositPayable(record.status) || record.coveredUah > 0)
      throw new ConflictException(ERROR.FIAT_DEPOSIT.NOT_PAYABLE)

    // Delegated rather than repeated: releasing a payout and closing the row
    // is one operation with one owner, whoever asked for it.
    const cancelled = ensure(
      await this.settlement.release(record, TmaFiatDepositStatus.CANCELLED),
      new ConflictException(ERROR.FIAT_DEPOSIT.NOT_PAYABLE)
    )

    return toFiatDepositContract(cancelled)
  }

  private async requireOwned(telegramId: number, depositId: string): Promise<TmaFiatDepositRecord> {
    return assertOwnedFiatDeposit(await this.fiatDepositDb.findById(depositId), telegramId)
  }

  /**
   * Candidates, or the right refusal.
   *
   * An unreachable panel and an amount nobody is offering are opposite
   * messages — "try again in a minute" against "pick another sum" — and the
   * caller cannot tell them apart from an empty array.
   */
  private async candidatesFor(amountUah: number): Promise<TransactoPanelPayoutRow[]> {
    const candidates = await this.book.findCandidates(amountUah).catch((error: unknown) => {
      this.logger.error(`Fiat book could not be read for a reservation: ${describeError(error)}`)
      throw new ServiceUnavailableException(ERROR.FIAT_DEPOSIT.BOOK_UNAVAILABLE)
    })

    if (candidates.length === 0) throw new ConflictException(ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE)

    return candidates
  }

  /**
   * Takes one payout and records it, or gives it straight back.
   *
   * `null` means "that one got away, try the next" — a payout another trader
   * took between the read and the assignment. Anything that leaves the payout
   * assigned to us without a document to account for it throws instead, because
   * a held payout nobody can see is worse than a failed reservation.
   */
  private async claim(
    telegramId: number,
    candidate: TransactoPanelPayoutRow,
    priced: { amountUah: number; exchangeRate: number; cryptoCents: number }
  ): Promise<TmaFiatDeposit | null> {
    const assigned = await this.panelPayouts.assignPayout(candidate.id).catch((error: unknown) => {
      this.logger.error(`Panel refused to assign payout ${candidate.id}: ${describeError(error)}`)
      return null
    })

    if (assigned?.status !== PANEL_OK) {
      // The expected way to lose a race. The panel's own words go to the log
      // because its refusal shape is not yet catalogued — see the interface.
      this.logger.log(
        `Payout ${candidate.id} could not be taken (${assigned?.status ?? 'no answer'}); trying the next`
      )
      return null
    }

    const now = Date.now()

    try {
      const created = await this.fiatDepositDb.create({
        telegramId,
        payoutId: candidate.id,
        // Taken from the pricing rather than re-read off the row: a candidate
        // is a row the book already matched *by* its parsed amount, so parsing
        // it again here would be a second answer to a settled question.
        ...priced,
        recipientCard: candidate.cred,
        payDeadlineAt: new Date(now + this.payWindowMinutes * MINUTE_MS),
        holdUntilAt: new Date(now + this.holdMinutes * MINUTE_MS)
      })

      // Never the card, and never the recipient: a log line is the one place a
      // payment credential leaks without anybody noticing.
      this.logger.log(
        `[fiat ${created._id.toString()}] reserved payout ${candidate.id} for telegramId ` +
          `${telegramId}: ${candidate.amount} UAH = ${priced.cryptoCents} USDT cents at ` +
          `${priced.exchangeRate}`
      )
      this.settlement.announce(created)

      return toFiatDepositContract(created)
    } catch (error: unknown) {
      await this.releaseUpstream(candidate.id)

      // Two indexes can refuse this insert, and they mean different things: the
      // user already holds a top-up, or this payout is already somebody's here.
      if (isDuplicateKeyOn(error, 'activeUserKey'))
        throw new ConflictException(ERROR.FIAT_DEPOSIT.ALREADY_ACTIVE)
      if (isDuplicateKeyOn(error, 'activePayoutId'))
        throw new ConflictException(ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE)

      throw error
    }
  }

  /**
   * Hands a payout back, swallowing whatever the panel says about it.
   *
   * Only for the path that is already handling a failure — a payout taken that
   * could not be recorded — where a throw would replace the real problem with a
   * second one. A release that did not happen is picked up by the hold sweep.
   */
  private async releaseUpstream(payoutId: number): Promise<void> {
    await this.panelPayouts.releasePayout(payoutId).catch((error: unknown) => {
      this.logger.error(`Could not release payout ${payoutId}: ${describeError(error)}`)
    })
  }
}
