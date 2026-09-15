import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common'
import { createHmac } from 'crypto'
import { Types } from 'mongoose'
import { ERROR, REFERRAL_MASKED_ID_LENGTH } from '@transacto/contracts'
import type {
  ReferralBalancesRes,
  ReferralEntry,
  ReferralSummary
} from '@transacto/contracts'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { ensure, miniAppLink } from 'src/shared/utils'
import environments from 'src/environments'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'

/**
 * Share of a referral's sold volume their referrer earns, when
 * `REFERRAL_RATE_PERCENT` says nothing.
 *
 * A business constant rather than a market price — unlike the exchange rate, a
 * compiled-in default cannot go stale — so it falls back rather than failing
 * closed. The value in force is snapshotted onto every payout, so changing it
 * never restates past earnings.
 *
 * The two spreads that price the product went the whole way and live in
 * `@transacto/contracts` with no environment variable at all; this one is still
 * configurable because it pays a third party rather than setting a price.
 */
const DEFAULT_REFERRAL_RATE_PERCENT = 0.1

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name)

  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly referralDbService: TmaReferralDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly tmaGateway: TmaGateway,
    private readonly balanceLedger: BalanceLedgerService
  ) {}

  /** Everything the Referral page renders, in one round trip. */
  async getSummary(telegramId: number): Promise<ReferralSummary> {
    // Minted here if absent rather than assumed present: a user who signed up
    // before the referral programme reaches this page without ever having had a
    // code, and that must show them a link, not a 500.
    const user = await this.userDbService.ensureReferralCode(
      ensure(
        await this.userDbService.findByTelegramId(telegramId),
        new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
      )
    )

    const [invited, totals, completedCount, invitedByCode] = await Promise.all([
      this.userDbService.findByReferrer(telegramId),
      this.referralDbService.sumByReferred(telegramId),
      this.saleDbService.countCompletedByTelegramId(telegramId),
      this.resolveReferrerCode(user.referredBy)
    ])

    const earningsByUser = new Map(totals.map((total) => [total.referredTelegramId, total]))

    const referrals = invited
      .map((referral) => this.toEntry(telegramId, referral, earningsByUser.get(referral.telegramId)))
      // Highest earner first; everyone who joined but has never sold sits
      // at 0 and therefore falls to the bottom on its own. Ties break on join
      // order so the list does not reshuffle between two identical loads.
      .toSorted((a, b) => b.earned - a.earned || a.joinedAt.localeCompare(b.joinedAt))

    const code = ensure(
      user.referralCode,
      new InternalServerErrorException(ERROR.REFERRAL.CODE_GENERATION_FAILED)
    )

    return {
      code,
      link: this.buildLink(code),
      ratePercent: this.getRatePercent(),
      balance: user.referralBalance,
      totalEarned: user.totalReferralEarned,
      totalVolume: referrals.reduce((sum, entry) => sum + entry.soldVolume, 0),
      invitedBy: invitedByCode,
      canRedeemCode: user.referredBy === null && completedCount === 0,
      referrals
    }
  }

  /**
   * Binds the caller to the owner of `code`, by hand.
   *
   * The deep-link path ({@link bindFromStartParam}) covers people who arrive
   * through a link; this covers someone who already had the app installed when
   * a friend sent them a code. It is deliberately narrower: only a user who has
   * never completed a sale may redeem, so an established account cannot
   * be retro-fitted onto somebody's link once its volume is known.
   */
  async redeemCode(telegramId: number, code: string): Promise<ReferralSummary> {
    const user = ensure(
      await this.userDbService.findByTelegramId(telegramId),
      new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    )

    if (user.referredBy !== null) throw new ConflictException(ERROR.REFERRAL.ALREADY_REFERRED)
    if (user.referralCode === code) throw new BadRequestException(ERROR.REFERRAL.SELF_REFERRAL)

    const completedCount = await this.saleDbService.countCompletedByTelegramId(telegramId)
    if (completedCount > 0) throw new ConflictException(ERROR.REFERRAL.NOT_ELIGIBLE)

    const referrer = ensure(
      await this.userDbService.findByReferralCode(code),
      new NotFoundException(ERROR.REFERRAL.CODE_NOT_FOUND)
    )
    if (referrer.telegramId === telegramId)
      throw new BadRequestException(ERROR.REFERRAL.SELF_REFERRAL)

    // `null` here means another request bound this user between the check above
    // and now — a lost race, not a missing user.
    const bound = await this.userDbService.bindReferrer(telegramId, referrer.telegramId)
    if (!bound) throw new ConflictException(ERROR.REFERRAL.ALREADY_REFERRED)

    this.logger.log(`User ${telegramId} redeemed referral code ${code} (${referrer.telegramId})`)

    return this.getSummary(telegramId)
  }

  /**
   * Binds a brand-new user to whoever's link they opened.
   *
   * `startParam` comes out of the Telegram-signed `initData`, so it cannot be
   * forged by the client — which is why this path needs none of the eligibility
   * checks `redeemCode` applies.
   *
   * Never throws: this runs inside authentication, and a bad or stale code must
   * not stop somebody logging in.
   */
  async bindFromStartParam(telegramId: number, startParam: string): Promise<void> {
    try {
      const referrer = await this.userDbService.findByReferralCode(startParam)
      if (!referrer) {
        this.logger.debug(`start_param ${startParam} matches no referral code; ignoring`)
        return
      }
      if (referrer.telegramId === telegramId) return

      const bound = await this.userDbService.bindReferrer(telegramId, referrer.telegramId)
      if (bound)
        this.logger.log(
          `User ${telegramId} joined through the link of ${referrer.telegramId} (${startParam})`
        )
    } catch (error: unknown) {
      this.logger.error(
        `Failed to bind referrer for user ${telegramId} from start_param ${startParam}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /** Moves referral money onto the spendable balance. */
  async transferToBalance(telegramId: number, amount: number): Promise<ReferralBalancesRes> {
    if (!Number.isInteger(amount) || amount <= 0)
      throw new BadRequestException(ERROR.REFERRAL.INVALID_AMOUNT)

    const balances = await this.balanceLedger.transferReferral(telegramId, amount)

    // Both figures moved, and the dashboard renders the spendable one, so both
    // pushes are needed for a client sitting on either screen.
    this.tmaGateway.emitBalanceUpdated(telegramId, balances.balance)
    await this.emitReferralBalance(telegramId)

    return balances
  }

  async setNameVisibility(telegramId: number, showNameToReferrer: boolean): Promise<void> {
    await this.userDbService.setNameVisibility(telegramId, showNameToReferrer)
  }

  /**
   * Pays the referrer of whoever sold this order.
   *
   * Called from the completion path, so it never throws: the balance commit it
   * follows has already succeeded, and losing a referral cut must not roll that
   * back or fail the user's order.
   *
   * The ledger row is written *before* the balance moves, on purpose. That row
   * carries the unique index on `saleId`, so it — not a read-then-write
   * check — is what makes the payout happen at most once, even if two callers
   * arrive at the same instant. The cost of that ordering is the narrow window
   * where the row exists and the credit has not landed; it is logged loudly
   * because it is reconcilable from the ledger, whereas the reverse ordering
   * would risk paying twice, which is not.
   */
  async creditForSale(
    order: TmaSale & { _id: Types.ObjectId },
    settledFiat: number = order.fiatAmount
  ): Promise<void> {
    try {
      const seller = await this.userDbService.findByTelegramId(order.telegramId)
      if (!seller?.referredBy) return

      const ratePercent = this.getRatePercent()
      // The settled figure, not the target. They are the same on a full fill;
      // on an order that closed by refunding an unfillable tail the target
      // includes hryvnia nobody ever paid, and paying a referrer a cut of it
      // would be inventing money.
      const amount = this.calculateReward(settledFiat, order.exchangeRate, ratePercent)
      // Sub-cent cuts round to nothing. Recording a zero-value row would only
      // add a line to the breakdown that reads as a bug.
      if (amount <= 0) return

      const recorded = await this.referralDbService.record({
        referrerTelegramId: seller.referredBy,
        referredTelegramId: order.telegramId,
        saleId: order._id,
        amount,
        fiatAmount: settledFiat,
        exchangeRate: order.exchangeRate,
        ratePercent
      })
      if (!recorded) return

      try {
        await this.userDbService.creditReferralBalance(seller.referredBy, amount)
      } catch (error: unknown) {
        this.logger.error(
          `Referral earning ${recorded._id.toString()} was recorded but crediting ` +
            `${amount} cents to user ${seller.referredBy} failed — balance is short by that ` +
            `amount and must be reconciled from the ledger: ${
              error instanceof Error ? error.message : String(error)
            }`
        )
        return
      }

      await this.emitReferralBalance(seller.referredBy)

      this.logger.log(
        `Referral payout: ${amount} cents to ${seller.referredBy} from sale ` +
          `${order.publicId} (${settledFiat} kopecks at ${ratePercent}%)`
      )
    } catch (error: unknown) {
      this.logger.error(
        `Referral payout for sale ${order._id.toString()} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * The cut for one sale, in USDT cents.
   *
   * `fiatAmount` is UAH kopecks and `exchangeRate` is UAH kopecks per USDT, so
   * `kopecks × percent / 100` gives kopecks of reward, dividing by the rate
   * gives USDT, and multiplying by 100 gives cents — the ×100 and ÷100 cancel,
   * which is why the expression looks shorter than the derivation.
   *
   * The order's own snapshotted rate is used rather than today's, so a payout
   * is worth what the order was priced at.
   */
  private calculateReward(fiatAmount: number, exchangeRate: number, ratePercent: number): number {
    if (exchangeRate <= 0) return 0

    return Math.round((fiatAmount * ratePercent) / exchangeRate)
  }

  /** Current referral rate from env, as a percentage. */
  private getRatePercent(): number {
    const configured = Number(environments.REFERRAL_RATE_PERCENT)

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_REFERRAL_RATE_PERCENT
  }

  /**
   * The link a user shares.
   *
   * `startapp` — not `start` — is what opens the Mini App directly with the
   * payload attached; `start` would open a bot chat instead.
   */
  private buildLink(code: string): string {
    const username = ensure(
      environments.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, ''),
      new InternalServerErrorException(ERROR.CONFIG.MISSING_BOT_USERNAME)
    )

    return miniAppLink(username, code)
  }

  private async resolveReferrerCode(referredBy: number | null): Promise<string | null> {
    if (referredBy === null) return null

    const referrer = await this.userDbService.findByTelegramId(referredBy)

    return referrer?.referralCode ?? null
  }

  private toEntry(
    referrerTelegramId: number,
    referral: StoredTmaUser,
    total: { earned: number; soldVolume: number } | undefined
  ): ReferralEntry {
    return {
      maskedId: this.maskedId(referrerTelegramId, referral.telegramId),
      displayName: this.displayName(referral),
      earned: total?.earned ?? 0,
      soldVolume: total?.soldVolume ?? 0,
      joinedAt: this.createdAt(referral)
    }
  }

  /** `null` unless this user chose to be identifiable to their referrer. */
  private displayName(referral: StoredTmaUser): string | null {
    if (!referral.showNameToReferrer) return null
    if (referral.username) return `@${referral.username}`

    return `${referral.firstName} ${referral.lastName}`.trim() || null
  }

  /**
   * A stable pseudonym for one referral, as seen by one referrer.
   *
   * Keyed on the bot token and salted with the referrer's own id, so it is
   * deterministic — the same row keeps the same label across reloads — while
   * being useless to anyone else: two referrers who share a referral see
   * different ids, and no id can be walked back to a Telegram account.
   */
  private maskedId(referrerTelegramId: number, referredTelegramId: number): string {
    const botToken = ensure(
      environments.TELEGRAM_BOT_TOKEN,
      new InternalServerErrorException(ERROR.TMA_AUTH.SERVER_MISCONFIGURED)
    )

    return createHmac('sha256', botToken)
      .update(`${referrerTelegramId}:${referredTelegramId}`)
      .digest('hex')
      .slice(0, REFERRAL_MASKED_ID_LENGTH)
      .toUpperCase()
  }

  private async emitReferralBalance(telegramId: number): Promise<void> {
    const user = await this.userDbService.findByTelegramId(telegramId)
    if (!user) return

    this.tmaGateway.emitReferralBalanceUpdated(telegramId, {
      referralBalance: user.referralBalance,
      totalEarned: user.totalReferralEarned
    })
  }

  /**
   * `timestamps: true` puts `createdAt` on the document but not on the class
   * Mongoose infers its type from, so it is read through a narrow cast rather
   * than by widening the schema.
   */
  private createdAt(document: unknown): string {
    const value = (document as { createdAt?: Date | string }).createdAt

    return value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString())
  }
}
