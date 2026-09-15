import { ERROR } from '@transacto/contracts'
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import { TmaUser, TmaUserDocument } from 'src/modules/repositories/tma-user-db/schemas'
import { ensure, generatePublicId, isDuplicateKeyOn } from 'src/shared/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** A lean user document plus its id — what every read path here returns. */
export type StoredTmaUser = TmaUser & { _id: Types.ObjectId }

/**
 * Attempts allowed when a generated referral code collides.
 *
 * At 36^8 a collision is a formality, but a unique index without a retry would
 * surface that formality as a failed login.
 */
const REFERRAL_CODE_ATTEMPTS = 5

@Injectable()
export class TmaUserDbService {
  private readonly logger = new Logger(TmaUserDbService.name)

  constructor(
    @InjectModel(TmaUser.name)
    private readonly userModel: Model<TmaUserDocument>
  ) {}

  /**
   * Upserts a TmaUser on Telegram auth — creates if new, updates profile fields if existing.
   *
   * Also guarantees a referral code on the way out. The collection predates the
   * referral programme, so existing users have none; backfilling here rather
   * than in a migration means the code appears on the owner's next open and no
   * deploy step can be forgotten.
   */
  async findOrCreate(
    telegramId: number,
    userData: { firstName?: string; lastName?: string; username?: string }
  ): Promise<{ user: StoredTmaUser; isNewUser: boolean }> {
    const existing = await this.userModel.findOne({ telegramId }).lean()

    if (existing) {
      // Update profile fields if changed
      await this.userModel.updateOne(
        { telegramId },
        {
          $set: {
            firstName: userData.firstName ?? existing.firstName,
            lastName: userData.lastName ?? existing.lastName,
            username: userData.username ?? existing.username
          }
        }
      )
      const updated = await this.userModel.findOne({ telegramId }).lean()
      const user = await this.ensureReferralCode(updated!)

      return { user, isNewUser: false }
    }

    const created = await this.createWithReferralCode(telegramId, userData)

    return { user: created, isNewUser: true }
  }

  async findByTelegramId(telegramId: number): Promise<StoredTmaUser | null> {
    return this.userModel.findOne({ telegramId }).lean()
  }

  /**
   * Atomically increment user balance by amountCents (USDT).
   *
   * Call it through `BalanceLedgerService` rather than directly: every movement
   * of the spendable balance owes the user an entry explaining it, and this
   * method writes only the number. The same goes for {@link freezeBalance},
   * {@link unfreezeBalance}, {@link transferReferralToBalance} and
   * {@link adjustBalance}.
   */
  async creditBalance(telegramId: number, amountCents: number): Promise<number> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId },
        { $inc: { balance: amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    this.logger.log(
      `Credited ${amountCents} cents to user ${telegramId}. New balance: ${result.balance}`
    )
    return result.balance
  }

  /**
   * Atomically freeze USDT: deducts from available balance, adds to frozenBalance.
   */
  async freezeBalance(
    telegramId: number,
    amountCents: number
  ): Promise<{ balance: number; frozenBalance: number }> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId, balance: { $gte: amountCents } },
        { $inc: { balance: -amountCents, frozenBalance: amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) {
      throw new ConflictException(ERROR.TMA_USER.INSUFFICIENT_BALANCE)
    }
    this.logger.log(
      `Frozen ${amountCents} cents for user ${telegramId}. Available: ${result.balance}, Frozen: ${result.frozenBalance}`
    )
    return { balance: result.balance, frozenBalance: result.frozenBalance }
  }

  /**
   * Atomically commit frozen USDT: just removes from frozenBalance.
   */
  async commitFrozenBalance(telegramId: number, amountCents: number): Promise<void> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId, frozenBalance: { $gte: amountCents } },
        { $inc: { frozenBalance: -amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) {
      throw new ConflictException(ERROR.TMA_USER.INSUFFICIENT_FROZEN_BALANCE)
    }
    this.logger.log(
      `Committed ${amountCents} frozen cents for user ${telegramId}. Remaining frozen: ${result.frozenBalance}`
    )
  }

  /**
   * Atomically rollback frozen USDT: removes from frozenBalance, adds back to available balance.
   *
   * Returns where it left both pots, like {@link freezeBalance}, because the
   * entry `BalanceLedgerService` books for this movement records the balance it
   * produced — and reading that back separately would be a second answer to a
   * question this write already answered.
   */
  async unfreezeBalance(
    telegramId: number,
    amountCents: number
  ): Promise<{ balance: number; frozenBalance: number }> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId, frozenBalance: { $gte: amountCents } },
        { $inc: { balance: amountCents, frozenBalance: -amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) {
      throw new ConflictException(ERROR.TMA_USER.INSUFFICIENT_FROZEN_BALANCE)
    }
    this.logger.log(
      `Unfrozen ${amountCents} cents for user ${telegramId}. Available: ${result.balance}, Frozen: ${result.frozenBalance}`
    )

    return { balance: result.balance, frozenBalance: result.frozenBalance }
  }

  /**
   * Atomically increment lifetime totalTurnover.
   */
  async incrementTurnover(telegramId: number, amountKopecks: number): Promise<number> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId },
        { $inc: { totalTurnover: amountKopecks } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    return result.totalTurnover
  }

  // --- Referral programme ---------------------------------------------------

  async findByReferralCode(referralCode: string): Promise<StoredTmaUser | null> {
    return this.userModel.findOne({ referralCode }).lean()
  }

  /** Everyone this user invited, oldest first. */
  async findByReferrer(referrerTelegramId: number): Promise<StoredTmaUser[]> {
    return this.userModel.find({ referredBy: referrerTelegramId }).sort({ createdAt: 1 }).lean()
  }

  /**
   * Binds a user to their referrer, exactly once.
   *
   * `referredBy: null` in the filter is the whole guarantee: two concurrent
   * redemptions race here and only the first finds an unbound document, so the
   * relationship can never be re-pointed and earnings can never be reassigned.
   * Returns `null` when the user was already bound, which the caller reports as
   * `ALREADY_REFERRED` rather than treating as a failure to find the user.
   */
  async bindReferrer(
    telegramId: number,
    referrerTelegramId: number
  ): Promise<StoredTmaUser | null> {
    return this.userModel
      .findOneAndUpdate(
        { telegramId, referredBy: null },
        { $set: { referredBy: referrerTelegramId } },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Credits a referral payout, moving both the spendable referral balance and
   * the lifetime total in one update so the page can never show a total smaller
   * than the balance sitting under it.
   */
  async creditReferralBalance(
    telegramId: number,
    amountCents: number
  ): Promise<{ referralBalance: number; totalReferralEarned: number }> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId },
        { $inc: { referralBalance: amountCents, totalReferralEarned: amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    this.logger.log(
      `Credited ${amountCents} referral cents to user ${telegramId}. ` +
        `Referral balance: ${result.referralBalance}, lifetime: ${result.totalReferralEarned}`
    )

    return {
      referralBalance: result.referralBalance,
      totalReferralEarned: result.totalReferralEarned
    }
  }

  /**
   * Moves referral money across to the spendable balance.
   *
   * Both sides move in a single atomic update guarded on sufficient referral
   * funds, so the pair cannot be observed mid-transfer and a double-submitted
   * request cannot overdraw. `totalReferralEarned` is deliberately untouched —
   * it records what was ever earned, not what is still sitting here.
   */
  async transferReferralToBalance(
    telegramId: number,
    amountCents: number
  ): Promise<{ referralBalance: number; balance: number }> {
    const result = await this.userModel
      .findOneAndUpdate(
        { telegramId, referralBalance: { $gte: amountCents } },
        { $inc: { referralBalance: -amountCents, balance: amountCents } },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new ConflictException(ERROR.REFERRAL.INSUFFICIENT_BALANCE)
    this.logger.log(
      `Transferred ${amountCents} referral cents to the balance of user ${telegramId}. ` +
        `Referral: ${result.referralBalance}, balance: ${result.balance}`
    )

    return { referralBalance: result.referralBalance, balance: result.balance }
  }

  async setNameVisibility(telegramId: number, showNameToReferrer: boolean): Promise<void> {
    const result = await this.userModel
      .updateOne({ telegramId }, { $set: { showNameToReferrer } })
      .lean()

    if (!result.matchedCount) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
  }

  /**
   * Creates a user, allocating the referral code here rather than in the caller.
   *
   * A pre-check for an unused code would still race two concurrent creates, so
   * the unique index is the authority and a duplicate key simply means "draw
   * again" — the same contract `TmaSaleDbService.create` works under.
   */
  private async createWithReferralCode(
    telegramId: number,
    userData: { firstName?: string; lastName?: string; username?: string }
  ): Promise<StoredTmaUser> {
    for (let attempt = 1; attempt <= REFERRAL_CODE_ATTEMPTS; attempt++) {
      const referralCode = generatePublicId()

      try {
        const created = await this.userModel.create({
          telegramId,
          firstName: userData.firstName ?? '',
          lastName: userData.lastName ?? '',
          username: userData.username ?? '',
          referralCode
        })

        return created.toObject()
      } catch (error: unknown) {
        if (!isDuplicateKeyOn(error, 'referralCode')) throw error

        this.logger.warn(
          `Referral code ${referralCode} collided (attempt ${attempt}/${REFERRAL_CODE_ATTEMPTS}), regenerating`
        )
      }
    }

    throw new InternalServerErrorException(ERROR.REFERRAL.CODE_GENERATION_FAILED)
  }

  /**
   * Gives a pre-existing user a referral code, if they do not have one yet.
   *
   * Public because authentication is not the only entry point: somebody who
   * signed up before the referral programme can deep-link straight to the
   * referral page, and that read has to be able to mint their code rather than
   * fail on its absence.
   *
   * The `referralCode: null` filter keeps this idempotent under concurrency —
   * and matches a missing field as well as an explicit null, which is what
   * makes it work on documents written before the field existed. Whichever
   * request writes first wins; the loser re-reads rather than overwriting a
   * code the user may already have shared.
   */
  async ensureReferralCode(user: StoredTmaUser): Promise<StoredTmaUser> {
    if (user.referralCode) return user

    for (let attempt = 1; attempt <= REFERRAL_CODE_ATTEMPTS; attempt++) {
      const referralCode = generatePublicId()

      try {
        const updated = await this.userModel
          .findOneAndUpdate(
            { telegramId: user.telegramId, referralCode: null },
            { $set: { referralCode } },
            { returnDocument: 'after' }
          )
          .lean()

        if (updated) return updated

        // Another request backfilled it between the read and this write, so the
        // filter matched nothing. Re-read rather than overwrite a code the user
        // may already have shared.
        return ensure(
          await this.userModel.findOne({ telegramId: user.telegramId }).lean(),
          new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
        )
      } catch (error: unknown) {
        if (!isDuplicateKeyOn(error, 'referralCode')) throw error

        this.logger.warn(
          `Referral code ${referralCode} collided while backfilling user ${user.telegramId} ` +
            `(attempt ${attempt}/${REFERRAL_CODE_ATTEMPTS}), regenerating`
        )
      }
    }

    throw new InternalServerErrorException(ERROR.REFERRAL.CODE_GENERATION_FAILED)
  }

  // --- Admin reads ----------------------------------------------------------

  /**
   * One page of users matching a filter, plus the size of the whole match.
   *
   * The admin panel is the only caller. Everything else here looks a user up by
   * a key it already holds, which is why this is the first unbounded read on
   * the collection — and why it is bounded by construction rather than by the
   * caller remembering to pass a limit.
   */
  async findPage(filter: QueryFilter<TmaUser>, page: PageQuery): Promise<Page<StoredTmaUser>> {
    const [items, total] = await Promise.all([
      this.userModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.userModel.countDocuments(filter)
    ])

    return { items, total }
  }

  /** Users by Telegram id, for denormalising a name onto rows of another collection. */
  async findManyByTelegramIds(telegramIds: readonly number[]): Promise<StoredTmaUser[]> {
    if (!telegramIds.length) return []

    return this.userModel.find({ telegramId: { $in: telegramIds } }).lean()
  }

  async countAll(filter: QueryFilter<TmaUser> = {}): Promise<number> {
    return this.userModel.countDocuments(filter)
  }

  /**
   * Every balance in the system, summed in one pass.
   *
   * An aggregation rather than three `find`s: the overview draws all three
   * figures at once, and summing them client-side would mean loading the whole
   * collection to add up numbers Mongo can add up itself.
   */
  async sumBalances(): Promise<{ spendable: number; frozen: number; referral: number }> {
    const [totals] = await this.userModel
      .aggregate<{ spendable: number; frozen: number; referral: number }>([
        {
          $group: {
            _id: null,
            spendable: { $sum: '$balance' },
            frozen: { $sum: '$frozenBalance' },
            referral: { $sum: '$referralBalance' }
          }
        },
        { $project: { _id: 0, spendable: 1, frozen: 1, referral: 1 } }
      ])
      .exec()

    return totals ?? { spendable: 0, frozen: 0, referral: 0 }
  }

  // --- Admin writes ---------------------------------------------------------

  /** Flips `isActive`. Returns the user as it now stands, or `null` if there is none. */
  async setActive(telegramId: number, isActive: boolean): Promise<StoredTmaUser | null> {
    return this.userModel
      .findOneAndUpdate({ telegramId }, { $set: { isActive } }, { returnDocument: 'after' })
      .lean()
  }

  /**
   * Moves one balance field by a signed number of cents, atomically.
   *
   * The guard lives in the filter, not in a preceding read: `$gte` on the field
   * being debited means the update matches nothing when the money is not there,
   * so two concurrent debits cannot both pass a check and then both apply. A
   * `null` return therefore means either "no such user" or "not enough" — the
   * caller separates them by looking the user up, which it only does on the
   * failure path.
   *
   * `field` is constrained to the two pots a correction may touch. `frozenBalance`
   * is deliberately not among them: it is the ledger of what running orders have
   * staked, and moving it by hand would leave an order whose stake no longer
   * matches what was taken for it.
   */
  async adjustBalance(
    telegramId: number,
    field: 'balance' | 'referralBalance',
    deltaCents: number
  ): Promise<StoredTmaUser | null> {
    const filter: QueryFilter<TmaUser> =
      deltaCents < 0 ? { telegramId, [field]: { $gte: Math.abs(deltaCents) } } : { telegramId }

    return this.userModel
      .findOneAndUpdate(filter, { $inc: { [field]: deltaCents } }, { returnDocument: 'after' })
      .lean()
  }
}
