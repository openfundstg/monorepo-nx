import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, QueryFilter, Types } from 'mongoose'
import {
  BALANCE_ACQUISITION_KINDS,
  BalanceEntryKind,
  TmaBalanceEntry,
  TmaBalanceEntryDocument
} from 'src/modules/repositories/tma-balance-entry-db/schemas'
import type {
  BackfillTmaBalanceEntryData,
  CreateTmaBalanceEntryData,
  TmaBalanceEntryRecord
} from 'src/modules/repositories/tma-balance-entry-db/interfaces'
import { isDuplicateKeyOn } from 'src/shared/utils'

/**
 * The source as an id, or `null` — never a throw.
 *
 * A caller passing something that is not an ObjectId is a bug, but not one
 * worth losing the entry over: the movement it explains has already happened,
 * and a row with no link still accounts for the money.
 */
const toSourceId = (value: Types.ObjectId | string | null | undefined): Types.ObjectId | null =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null

@Injectable()
export class TmaBalanceEntryDbService {
  constructor(
    @InjectModel(TmaBalanceEntry.name)
    private readonly entryModel: Model<TmaBalanceEntryDocument>
  ) {}

  /**
   * Books one movement, or reports that it was already booked.
   *
   * `null` means the `dedupeKey` is taken — the same movement reached here
   * twice, which is the ordinary outcome of a retried request or a reconciler
   * passing over the same completed deposit again. It is not an error and the
   * caller must not treat it as one: the entry it wanted exists.
   */
  async create(data: CreateTmaBalanceEntryData): Promise<TmaBalanceEntryRecord | null> {
    try {
      const created = await this.entryModel.create({
        ...data,
        sourceId: toSourceId(data.sourceId),
        dedupeKey: data.dedupeKey ?? null
      })

      return created.toObject<TmaBalanceEntryRecord>()
    } catch (error: unknown) {
      if (isDuplicateKeyOn(error, 'dedupeKey')) return null
      throw error
    }
  }

  /**
   * Writes a row for a movement that happened before this book existed.
   *
   * `timestamps: false` on the write, which is the whole point: with them on,
   * Mongoose stamps `createdAt` with the moment of the migration and a
   * reconstructed history collapses onto the day it was reconstructed. The
   * timestamps stay on for every other write, where now *is* the answer.
   *
   * `null` on a duplicate, exactly as {@link create}: re-running a backfill is
   * a thing operators do.
   */
  async backfill(data: BackfillTmaBalanceEntryData): Promise<TmaBalanceEntryRecord | null> {
    try {
      const [created] = await this.entryModel.insertMany(
        [
          {
            ...data,
            sourceId: toSourceId(data.sourceId),
            dedupeKey: data.dedupeKey ?? null,
            balanceAfter: data.balanceAfter ?? null,
            updatedAt: data.createdAt
          }
        ],
        { timestamps: false }
      )

      return created.toObject<TmaBalanceEntryRecord>()
    } catch (error: unknown) {
      if (isDuplicateKeyOn(error, 'dedupeKey')) return null
      throw error
    }
  }

  /**
   * What this user's entries add up to, in USDT cents.
   *
   * The reconciliation: it must equal their `balance`, because every write that
   * touches that field books an entry here. The backfill reads it to work out
   * what the reconstructed history fails to explain, and books the difference
   * as the balance brought forward.
   */
  async sumForUser(telegramId: number): Promise<number> {
    const [totals] = await this.entryModel
      .aggregate<{ total: number }>([
        { $match: { telegramId } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } },
        { $project: { _id: 0, total: 1 } }
      ])
      .exec()

    return totals?.total ?? 0
  }

  /**
   * When the book started being written, or `null` while it is empty.
   *
   * The earliest entry the *product* wrote, ignoring reconstructed ones. It is
   * the line a backfill works below: everything older than it moved a balance
   * before anything was recording, and everything newer already has its row.
   * Reconstructing across that line is how a movement gets counted twice.
   */
  async findFirstLiveAt(): Promise<Date | null> {
    const first = await this.entryModel
      .findOne({ backfilledBy: null })
      .sort({ createdAt: 1 })
      .lean<{ createdAt: Date }>()

    return first?.createdAt ?? null
  }

  /** Removes one migration's reconstructed rows, and only those. */
  async deleteBackfilledBy(migration: string): Promise<number> {
    const { deletedCount } = await this.entryModel.deleteMany({ backfilledBy: migration })

    return deletedCount
  }

  /**
   * Every movement that put USDT on this user's balance, oldest first.
   *
   * The lot ledger the income page matches sales against, and it is this
   * collection rather than the deposit ones because only this collection is
   * *complete*: a referral transfer, an operator's correction and a balance
   * carried forward all add USDT and none of them has a deposit document. A
   * matcher fed only deposits would find sales it could not account for and
   * would report them as costless — which is the right answer for USDT the user
   * really did bring in, and the wrong one for USDT we simply forgot to look
   * for.
   *
   * **Filtered by kind, not by sign**, and the difference is a bug this had.
   * `SALE_REFUND` is booked positive and is not an arrival — it is the
   * unfrozen half of a stake returning — so `amountCents > 0` minted a second,
   * costless lot for USDT already in the book, once per part-filled order.
   * {@link BALANCE_ACQUISITION_KINDS} is where that distinction is now stated.
   *
   * The sign still guards the one kind that is signed either way: an operator's
   * correction may take USDT off a balance, and a negative one is not an
   * arrival however it is classified. It also does not yet *consume* a lot —
   * corrections are rare, none exists in production, and inventing a disposal
   * with no proceeds would distort the average sale rate beside it.
   *
   * What USDT actually left a balance is not in here either: a stake is a
   * reservation and may be refunded, so the disposal is the committed part of
   * an ended sale, which `saleDisposal` reads off the order.
   *
   * Projected, because the matcher reads four fields and the rest of an entry
   * is bytes over the wire nobody looks at.
   */
  async findAcquisitions(telegramId: number): Promise<TmaBalanceEntryRecord[]> {
    return this.entryModel
      .find(
        {
          telegramId,
          kind: { $in: BALANCE_ACQUISITION_KINDS },
          amountCents: { $gt: 0 }
        },
        { kind: 1, amountCents: 1, sourceId: 1, createdAt: 1 }
      )
      .sort({ createdAt: 1 })
      .lean<TmaBalanceEntryRecord[]>()
  }

  /**
   * Rewrites one stored `kind`, and the dedupe key that embeds it.
   *
   * Both, because `BalanceLedgerService` builds the key as
   * `${kind}:${sourceId}` — so a rename that touched only the classification
   * would leave a unique key still naming the old one, and a reconciler
   * re-booking that movement would then write a second entry instead of being
   * refused by the index.
   *
   * `from` is a plain string rather than a `BalanceEntryKind`: the value being
   * migrated *away* from is by definition no longer a member of that enum.
   *
   * Idempotent — a second run matches nothing, because the first left no rows
   * with the old value.
   */
  async renameKind(from: string, to: BalanceEntryKind): Promise<number> {
    const { modifiedCount } = await this.entryModel.updateMany(
      { kind: from } as QueryFilter<TmaBalanceEntry>,
      [{ $set: { kind: to, dedupeKey: rewrittenDedupeKey(from, to) } }],
      // Mongoose 9 refuses an array update without this, and refuses it at
      // runtime rather than at compile time — the same trap `updateJarBalance`
      // documents, and the reason a migration that looked right would have
      // thrown on the one run it gets.
      { updatePipeline: true }
    )

    return modifiedCount ?? 0
  }

  /** One user's movements of the given kinds, newest first. */
  async findByKinds(
    telegramId: number,
    kinds: readonly BalanceEntryKind[],
    limit: number
  ): Promise<TmaBalanceEntryRecord[]> {
    return this.entryModel
      .find({ telegramId, kind: { $in: kinds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<TmaBalanceEntryRecord[]>()
  }
}

/**
 * The dedupe key with a renamed kind inside it.
 *
 * `BalanceLedgerService` builds the key as `${kind}:${sourceId}`, so a rename
 * that touched only the classification would leave a unique key still naming the
 * old one — and a reconciler re-booking that movement would write a second entry
 * instead of being refused by the index.
 *
 * No guard for the absent case: `dedupeKey` is declared `default: null`, so it
 * is a string or `null`, and `$replaceOne` answers `null` for a `null` input.
 */
const rewrittenDedupeKey = (from: string, to: BalanceEntryKind): Record<string, unknown> => ({
  $replaceOne: { input: '$dedupeKey', find: from, replacement: to }
})
