import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, QueryFilter, Types } from 'mongoose'
import { isDuplicateKeyOn } from 'src/shared/utils'
import {
  TmaFiatDepositWatch,
  TmaFiatDepositWatchDocument
} from 'src/modules/repositories/tma-fiat-deposit-watch-db/schemas'
import type {
  SaveTmaFiatDepositWatchData,
  TmaFiatDepositWatchRecord
} from 'src/modules/repositories/tma-fiat-deposit-watch-db/interfaces'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

@Injectable()
export class TmaFiatDepositWatchDbService {
  constructor(
    @InjectModel(TmaFiatDepositWatch.name)
    private readonly watchModel: Model<TmaFiatDepositWatchDocument>
  ) {}

  async findByTelegramId(telegramId: number): Promise<TmaFiatDepositWatchRecord | null> {
    return this.watchModel.findOne({ telegramId }).lean<TmaFiatDepositWatchRecord>()
  }

  /**
   * Creates the user's request, or replaces the one they had.
   *
   * **`lastNotifiedAt` is reset, not carried over.** A changed range is a
   * different question, and a stamp from the old one would tell the panel this
   * request had already been answered when nothing in it ever has. Re-saving an
   * identical range resets it too, which is the right reading of a user going
   * back to the screen and asking again.
   *
   * One document per user, guaranteed by the unique index rather than by this
   * method — see the retry below for the one way the two can disagree.
   */
  async save(
    telegramId: number,
    data: SaveTmaFiatDepositWatchData
  ): Promise<TmaFiatDepositWatchRecord> {
    try {
      return await this.upsert(telegramId, data)
    } catch (error: unknown) {
      // An upsert against a unique index is the one case MongoDB documents as
      // able to raise E11000 anyway: two concurrent ones both miss the document
      // and both insert. The second attempt finds what the first wrote and
      // updates it, which is the same one-document outcome — so the race costs
      // a round trip rather than a 500 on a double-tapped button.
      if (!isDuplicateKeyOn(error, 'telegramId')) throw error

      return this.upsert(telegramId, data)
    }
  }

  private async upsert(
    telegramId: number,
    data: SaveTmaFiatDepositWatchData
  ): Promise<TmaFiatDepositWatchRecord> {
    return this.watchModel
      .findOneAndUpdate(
        { telegramId },
        { $set: { ...data, lastNotifiedAt: null }, $setOnInsert: { telegramId } },
        // `returnDocument`, not `new`: Mongoose 9 deprecates the latter and
        // warns on every call.
        { returnDocument: 'after', upsert: true }
      )
      .lean<TmaFiatDepositWatchRecord>()
  }

  /** Whether there was one to remove — which is what a bot's unsubscribe reports. */
  async removeByTelegramId(telegramId: number): Promise<boolean> {
    const { deletedCount } = await this.watchModel.deleteOne({ telegramId })

    return deletedCount > 0
  }

  /**
   * Requests whose range could contain one of these amounts.
   *
   * A **prefilter**, and named as one: two bounds cannot express "contains any
   * member of this set", so this narrows to the requests overlapping the span
   * from the cheapest amount to the dearest and leaves the per-amount match to
   * the caller. The alternative — an `$or` of one clause per amount — grows
   * with the book and is a worse query for the same answer.
   *
   * An empty list of amounts matches nothing, rather than everything.
   */
  async findOverlapping(amountsUah: readonly number[]): Promise<TmaFiatDepositWatchRecord[]> {
    if (amountsUah.length === 0) return []

    return this.watchModel
      .find({
        minAmountUah: { $lte: Math.max(...amountsUah) },
        maxAmountUah: { $gte: Math.min(...amountsUah) }
      })
      .lean<TmaFiatDepositWatchRecord[]>()
  }

  /**
   * Both take the id as a **string**, which is what the domain event carries.
   *
   * Turning it into an `ObjectId` is this layer's job, and doing it here is
   * what keeps mongoose out of the support module — the only consumer of these
   * two — rather than making it import `Types` to talk to a repository.
   *
   * An id that is not one at all is a no-op rather than a throw: it can only
   * reach here from a malformed event, and a listener that cannot settle a
   * request must not take the message it just sent down with it.
   */
  async markNotified(id: string, at: Date): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return

    await this.watchModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: { lastNotifiedAt: at } })
  }

  async removeById(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return

    await this.watchModel.deleteOne({ _id: new Types.ObjectId(id) })
  }

  async findPage(
    filter: QueryFilter<TmaFiatDepositWatch>,
    page: PageQuery
  ): Promise<Page<TmaFiatDepositWatchRecord>> {
    const [items, total] = await Promise.all([
      this.watchModel
        .find(filter)
        .sort(page.sort)
        .skip(page.skip)
        .limit(page.limit)
        .lean<TmaFiatDepositWatchRecord[]>(),
      this.watchModel.countDocuments(filter)
    ])

    return { items, total }
  }
}
