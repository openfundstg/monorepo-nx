import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import {
  TmaReferralEarning,
  TmaReferralEarningDocument
} from 'src/modules/repositories/tma-referral-db/schemas'
import type { ReferralEarningTotal } from 'src/modules/repositories/tma-referral-db/interfaces'
import { isDuplicateKeyOn, isMissingIndex } from 'src/shared/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** What the field pointing at a sale was called, and the unique index on it. */
const LEGACY_SALE_ID_FIELD = 'scrollOrderId'
const LEGACY_SALE_ID_INDEX = 'scrollOrderId_1'

@Injectable()
export class TmaReferralDbService {
  private readonly logger = new Logger(TmaReferralDbService.name)

  constructor(
    @InjectModel(TmaReferralEarning.name)
    private readonly earningModel: Model<TmaReferralEarningDocument>
  ) {}

  /**
   * Writes a payout row, or reports that this order already produced one.
   *
   * The unique index on `saleId` is what makes this safe to call from a
   * money path that may be re-entered: a second attempt for the same order
   * raises a duplicate key, which is caught and answered with `null` rather
   * than an error. The caller reads `null` as "already paid, credit nothing" —
   * so writing the ledger row *before* incrementing the balance makes the whole
   * payout idempotent, with the database as the arbiter instead of a
   * read-then-write check that two concurrent callers would both pass.
   */
  async record(data: {
    referrerTelegramId: number
    referredTelegramId: number
    saleId: Types.ObjectId
    amount: number
    fiatAmount: number
    exchangeRate: number
    ratePercent: number
  }): Promise<(TmaReferralEarning & { _id: Types.ObjectId }) | null> {
    try {
      const earning = await this.earningModel.create(data)

      return earning.toObject()
    } catch (error: unknown) {
      if (!isDuplicateKeyOn(error, 'saleId')) throw error

      this.logger.debug(
        `Sale ${data.saleId.toString()} already produced a referral payout; skipping`
      )

      return null
    }
  }

  /**
   * Per-referral totals for one referrer, highest earner first.
   *
   * Aggregated rather than counted on the user document so the breakdown and
   * the lifetime figure are always the same money seen two ways.
   */
  async sumByReferred(referrerTelegramId: number): Promise<ReferralEarningTotal[]> {
    return this.earningModel
      .aggregate<ReferralEarningTotal>([
        { $match: { referrerTelegramId } },
        {
          $group: {
            _id: '$referredTelegramId',
            earned: { $sum: '$amount' },
            soldVolume: { $sum: '$fiatAmount' }
          }
        },
        { $project: { _id: 0, referredTelegramId: '$_id', earned: 1, soldVolume: 1 } },
        { $sort: { earned: -1 } }
      ])
      .exec()
  }

  // --- Admin reads ----------------------------------------------------------

  async findPage(
    filter: QueryFilter<TmaReferralEarning>,
    page: PageQuery
  ): Promise<Page<TmaReferralEarning & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.earningModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.earningModel.countDocuments(filter)
    ])

    return { items, total }
  }

  /** Lifetime payouts to one referrer, in USDT cents. */
  async sumForReferrer(referrerTelegramId: number): Promise<number> {
    const [totals] = await this.earningModel
      .aggregate<{ earned: number }>([
        { $match: { referrerTelegramId } },
        { $group: { _id: null, earned: { $sum: '$amount' } } },
        { $project: { _id: 0, earned: 1 } }
      ])
      .exec()

    return totals?.earned ?? 0
  }
  /**
   * Renames the field that used to point at a sale, and the index on it.
   *
   * **`strict: false`, and it is load-bearing.** `scrollOrderId` is not on the
   * schema any more, and Mongoose's default `strict: true` silently drops every
   * update key it does not recognise — including the source of a `$rename`. The
   * update would report success, modify nothing, and leave the dedupe guard in
   * {@link record} matching no document.
   *
   * **The index has to move with the field, and it has to move first.**
   * `scrollOrderId_1` is `unique` and not sparse, so the moment the second
   * document loses the field they both index as `null` and the write aborts with
   * a duplicate key — a half-renamed collection, on the one path in this product
   * that stops a referrer being paid twice. Dropping it before the rename is
   * what makes the rename possible.
   *
   * And `syncIndexes` afterwards, because nothing else will build `saleId_1`.
   * Mongoose reconciles indexes when a model is first built, which here happens
   * *before* this runs, when no document has a `saleId` at all — every key would
   * be `null`, the unique index would fail, and `Model.init` swallows that
   * error. Without this call the guard the rename exists to preserve would be
   * gone and nothing would say so.
   *
   * Idempotent: documents that still carry the old field are the filter, and
   * both index operations are safe to repeat.
   */
  async renameLegacySaleIdField(): Promise<number> {
    await this.dropLegacyIndex()

    const { modifiedCount } = await this.earningModel.updateMany(
      { [LEGACY_SALE_ID_FIELD]: { $exists: true } },
      { $rename: { [LEGACY_SALE_ID_FIELD]: 'saleId' } },
      { strict: false }
    )

    await this.earningModel.syncIndexes()

    return modifiedCount ?? 0
  }

  /**
   * Removes the unique index on the old field name, if it is still there.
   *
   * Swallows only the "no such index" refusal — anything else is a database
   * saying something this migration needs to hear.
   */
  private async dropLegacyIndex(): Promise<void> {
    try {
      await this.earningModel.collection.dropIndex(LEGACY_SALE_ID_INDEX)
    } catch (error: unknown) {
      if (!isMissingIndex(error)) throw error
    }
  }

}
