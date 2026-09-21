import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, QueryFilter, Types } from 'mongoose'
import { BankProvider, TmaFiatReceiptRejection, TmaFiatReceiptStatus } from '@transacto/contracts'
import {
  HELD_FIAT_DEPOSIT_STATUSES,
  LIVE_FIAT_DEPOSIT_STATUSES,
  TmaFiatDeposit,
  TmaFiatDepositDocument,
  TmaFiatDepositStatus
} from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import type {
  CreateTmaFiatDepositData,
  TmaFiatDepositRecord
} from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

@Injectable()
export class TmaFiatDepositDbService {
  constructor(
    @InjectModel(TmaFiatDeposit.name)
    private readonly fiatDepositModel: Model<TmaFiatDepositDocument>
  ) {}

  /**
   * Inserts a reservation, both locks armed.
   *
   * Throws Mongo's duplicate-key error when the user already holds a live
   * top-up or the payout is already spoken for. That throw *is* the check —
   * see the unique partial indexes on the schema — so the caller translates it
   * rather than trying to prevent it with a prior read.
   */
  async create(data: CreateTmaFiatDepositData): Promise<TmaFiatDepositRecord> {
    const created = await this.fiatDepositModel.create({
      ...data,
      activeUserKey: data.telegramId,
      activePayoutId: data.payoutId
    })

    return created.toObject<TmaFiatDepositRecord>()
  }

  async findById(id: string): Promise<TmaFiatDepositRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null

    return this.fiatDepositModel.findById(id).lean<TmaFiatDepositRecord>()
  }

  /** The user's live top-up, if they have one. */
  async findActiveByTelegramId(telegramId: number): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel.findOne({ activeUserKey: telegramId }).lean<TmaFiatDepositRecord>()
  }

  /**
   * Whether this user has ever completed a hryvnia top-up.
   *
   * `COMPLETED` only: it is the one status that means Transacto reported the
   * payout executed and a balance moved. A top-up sitting in `REVIEW` is money
   * an operator has not finished arguing about, and a partially paid one is a
   * transfer in flight — neither is evidence of anything yet.
   */
  async hasCompleted(telegramId: number): Promise<boolean> {
    const found = await this.fiatDepositModel.exists({
      telegramId,
      status: TmaFiatDepositStatus.COMPLETED
    })

    return found !== null
  }

  async findByTelegramId(telegramId: number, limit: number): Promise<TmaFiatDepositRecord[]> {
    return this.fiatDepositModel
      .find({ telegramId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<TmaFiatDepositRecord[]>()
  }

  /**
   * What this user actually paid, per completed top-up, keyed by the top-up.
   *
   * A map rather than documents, because the one caller — the earnings page —
   * wants exactly this lookup, and the alternative it replaced was
   * `findByTelegramId(telegramId, Number.MAX_SAFE_INTEGER)`: every top-up in
   * every status, each carrying its `receipts` subdocuments, to read one number
   * off each. A sentinel passed to defeat a limit is a sign the caller wanted a
   * different query.
   *
   * `COMPLETED` only. A top-up that never settled bought no USDT, so its
   * hryvnia is not the cost of anything.
   */
  async amountPaidByCompletedTopUp(telegramId: number): Promise<Map<string, number>> {
    const settled = await this.fiatDepositModel
      .find({ telegramId, status: TmaFiatDepositStatus.COMPLETED }, { amountUah: 1 })
      .lean<{ _id: Types.ObjectId; amountUah: number }[]>()

    return new Map(settled.map((topUp) => [topUp._id.toString(), topUp.amountUah]))
  }

  /**
   * Every top-up whose payout is still ours — live **and** under review.
   *
   * The reconciler's whole working set, in one read. It used to take a narrower
   * one too, for the passes that only touch top-ups still accepting receipts;
   * `isFiatDepositPayable` narrows this in memory instead, because the two
   * queries were two chances to disagree about a relationship the contracts
   * package already defines.
   *
   * The wider set is what the settlement pass needs, and the extra state is the
   * one that made it necessary. A top-up under review takes no more receipts,
   * but its payout is still held in the user's name, and somebody can still
   * settle it upstream: support checking a receipt our own verification refused
   * and uploading it through Transacto's panel is the ordinary way that
   * happens. When it does, Transacto reports the payout executed and the user
   * is owed their USDT — whatever our row happens to say.
   *
   * It went unread for exactly that reason once: a top-up whose receipt we
   * refused sat under review while its payout had been paid and closed
   * upstream, and only an operator pressing a button three hours later credited
   * anybody.
   */
  async findHeld(): Promise<TmaFiatDepositRecord[]> {
    return this.fiatDepositModel
      .find({ status: { $in: HELD_FIAT_DEPOSIT_STATUSES } })
      .lean<TmaFiatDepositRecord[]>()
  }

  /** Live top-ups whose hold has run out, oldest first. */
  async findDueForRelease(now: Date): Promise<TmaFiatDepositRecord[]> {
    return this.fiatDepositModel
      .find({ status: { $in: LIVE_FIAT_DEPOSIT_STATUSES }, holdUntilAt: { $lte: now } })
      .sort({ holdUntilAt: 1 })
      .lean<TmaFiatDepositRecord[]>()
  }

  /**
   * Payout ids we currently hold, so the book never offers one back to a user.
   *
   * Read off `status` rather than off the lock field: the lock exists to make
   * the unique index enforceable, and a second query shape over it would make
   * two sources of the same truth out of one.
   */
  async findHeldPayoutIds(): Promise<number[]> {
    const held = await this.fiatDepositModel
      .find({ status: { $in: HELD_FIAT_DEPOSIT_STATUSES } }, { payoutId: 1, _id: 0 })
      .lean<{ payoutId: number }[]>()

    return held.map(({ payoutId }) => payoutId)
  }

  /** One page of top-ups for the admin panel, filtered and sorted by it. */
  async findPage(
    filter: QueryFilter<TmaFiatDeposit>,
    page: PageQuery
  ): Promise<Page<TmaFiatDepositRecord>> {
    const [items, total] = await Promise.all([
      this.fiatDepositModel
        .find(filter)
        .sort(page.sort)
        .skip(page.skip)
        .limit(page.limit)
        .lean<TmaFiatDepositRecord[]>(),
      this.fiatDepositModel.countDocuments(filter)
    ])

    return { items, total }
  }

  /** Appends an uploaded receipt in PARSING and returns its new `_id`. */
  async pushReceipt(
    id: string,
    receipt: {
      uploadedAt: Date
      upstreamJobId: number | null
      recipientChecked?: boolean
      bank?: BankProvider | null
    }
  ): Promise<Types.ObjectId> {
    const receiptId = new Types.ObjectId()

    await this.fiatDepositModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $push: {
          receipts: {
            _id: receiptId,
            status: TmaFiatReceiptStatus.PARSING,
            rejection: null,
            amountUah: null,
            checkUrl: null,
            recipientChecked: true,
            bank: null,
            storedName: null,
            sizeBytes: null,
            purgedAt: null,
            ...receipt
          }
        }
      }
    )

    return receiptId
  }

  /**
   * Notes where a receipt's bytes were archived.
   *
   * A second write rather than a field on {@link pushReceipt}, because the id
   * the file is named for is the one that write mints — the row has to exist
   * before the file can be named after it. A receipt whose archiving failed
   * keeps `storedName: null` and is a receipt with no copy, which is a
   * recoverable state and says so.
   */
  async markReceiptArchived(
    id: string,
    receiptId: Types.ObjectId,
    file: { storedName: string; sizeBytes: number }
  ): Promise<void> {
    await this.fiatDepositModel.updateOne(
      { _id: new Types.ObjectId(id), 'receipts._id': receiptId },
      {
        $set: {
          'receipts.$.storedName': file.storedName,
          'receipts.$.sizeBytes': file.sizeBytes
        }
      }
    )
  }

  /**
   * Receipts whose bytes are older than the retention and still on disk.
   *
   * Returns the handles the sweep needs and nothing else — the deposit, the
   * receipt and the file's name. The row itself is never deleted: what the
   * receipt was judged to say is the record, and only the document goes.
   */
  async findReceiptsToPurge(
    uploadedBefore: Date,
    limit: number
  ): Promise<{ depositId: string; receiptId: Types.ObjectId; storedName: string }[]> {
    const rows = await this.fiatDepositModel
      .aggregate<{ depositId: Types.ObjectId; receiptId: Types.ObjectId; storedName: string }>([
        { $match: { 'receipts.storedName': { $ne: null } } },
        { $unwind: '$receipts' },
        {
          $match: {
            'receipts.storedName': { $ne: null },
            'receipts.purgedAt': null,
            'receipts.uploadedAt': { $lt: uploadedBefore }
          }
        },
        {
          $project: {
            _id: 0,
            depositId: '$_id',
            receiptId: '$receipts._id',
            storedName: '$receipts.storedName'
          }
        },
        { $limit: limit }
      ])
      .exec()

    return rows.map((row) => ({ ...row, depositId: row.depositId.toString() }))
  }

  /** Records that a receipt's file is gone, leaving everything it said behind. */
  async markReceiptPurged(
    id: string,
    receiptId: Types.ObjectId,
    purgedAt: Date
  ): Promise<void> {
    await this.fiatDepositModel.updateOne(
      { _id: new Types.ObjectId(id), 'receipts._id': receiptId },
      { $set: { 'receipts.$.purgedAt': purgedAt } }
    )
  }

  /**
   * Notes the recognition job a receipt is waiting on.
   *
   * Stored rather than merely held in the request that started it: a request
   * that dies mid-recognition leaves a receipt whose answer is sitting unread
   * upstream, and the job id is the only handle left to collect it with.
   */
  async markReceiptParsing(
    id: string,
    receiptId: Types.ObjectId,
    upstreamJobId: number
  ): Promise<void> {
    await this.fiatDepositModel.updateOne(
      { _id: new Types.ObjectId(id), 'receipts._id': receiptId },
      { $set: { 'receipts.$.upstreamJobId': upstreamJobId } }
    )
  }

  /**
   * Records that Transacto took the receipt, and moves the same figure into
   * `coveredUah` in the one write.
   *
   * `$inc` rather than a computed total: the reconciler and an upload can land
   * together, and a read-modify-write of the sum loses one of them — which
   * would mean a user's own money going uncounted.
   *
   * `status` is passed in rather than derived here because whether a covered
   * payout is *complete* is Transacto's answer, not arithmetic of ours.
   */
  async markReceiptAccepted(
    id: string,
    receiptId: Types.ObjectId,
    accepted: { amountUah: number; checkUrl: string | null; status: TmaFiatDepositStatus }
  ): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), 'receipts._id': receiptId },
        {
          $set: {
            'receipts.$.status': TmaFiatReceiptStatus.ACCEPTED,
            'receipts.$.rejection': null,
            'receipts.$.amountUah': accepted.amountUah,
            'receipts.$.checkUrl': accepted.checkUrl,
            'receipts.$.upstreamJobId': null,
            status: accepted.status
          },
          $inc: { coveredUah: accepted.amountUah }
        },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }

  async markReceiptRejected(
    id: string,
    receiptId: Types.ObjectId,
    rejection: TmaFiatReceiptRejection
  ): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), 'receipts._id': receiptId },
        {
          $set: {
            'receipts.$.status': TmaFiatReceiptStatus.REJECTED,
            'receipts.$.rejection': rejection,
            'receipts.$.upstreamJobId': null
          }
        },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }

  /**
   * Closes a top-up as paid, disarming both locks.
   *
   * Conditional on the row still being live, and the caller credits only when
   * this returns a document: two reconciler passes seeing the same completed
   * payout would otherwise both call for a credit, and the second would pay a
   * user twice for one transfer.
   */
  async markCompleted(id: string, completedAt: Date): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        // `HELD`, like `markReleased`, and for the same reason: the question is
        // whether this payout is still ours to settle, and a top-up under
        // review is. It asked `LIVE` before, so the panel's COMPLETE button
        // matched nothing on exactly the rows it exists for — REVIEW is the
        // state where an operator decides between completing and releasing, and
        // one of the two buttons quietly did nothing.
        //
        // Safe in the other direction by construction: `complete` writes here
        // *before* it credits, so a row this does not match credits nobody.
        // That ordering is what kept the broken guard from paying anyone twice,
        // and it is unchanged.
        //
        // `settleAgainstHistory` now finds its candidates through `findHeld`,
        // so this guard is also what lets the automatic pass close a review
        // whose payout Transacto reports executed — the case where somebody
        // settled it in the panel while our own verification had already given
        // up on it.
        { _id: new Types.ObjectId(id), status: { $in: HELD_FIAT_DEPOSIT_STATUSES } },
        {
          $set: {
            status: TmaFiatDepositStatus.COMPLETED,
            completedAt,
            activeUserKey: null,
            activePayoutId: null
          }
        },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }

  /**
   * Closes an unpaid top-up whose payout has gone back to Transacto's book.
   *
   * Takes the ending rather than assuming one: a clock ran out and a person
   * changed their mind are the same fact for the ledger and different facts for
   * whoever reads the row later.
   *
   * Also conditional on the row still being live, so a release racing a receipt
   * that just landed loses: the receipt wins, and the top-up stays payable.
   */
  async markReleased(
    id: string,
    status: TmaFiatDepositStatus.EXPIRED | TmaFiatDepositStatus.CANCELLED,
    releasedAt: Date
  ): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        // **Held, not live.** The question this guard asks is "is the payout
        // still ours to give back", and that is exactly what
        // `HELD_FIAT_DEPOSIT_STATUSES` means — it is `LIVE` plus `REVIEW`.
        //
        // It used to ask `LIVE`, and the mismatch cost more than it looks.
        // `FiatDepositSettlementService.release` hands the payout back upstream
        // *first* and marks the row afterwards, so on a top-up under review the
        // payout went back to Transacto and this matched nothing: the row stayed
        // REVIEW, `findHeldPayoutIds` went on counting a payout we no longer
        // had, and that payout id could never be offered to anybody again. The
        // panel's own RELEASE button did this every time it was pressed on a
        // review.
        //
        // Widening it opens no new path for a user: `cancel` checks
        // `isFiatDepositPayable` before it gets here, and a review is not
        // payable.
        { _id: new Types.ObjectId(id), status: { $in: HELD_FIAT_DEPOSIT_STATUSES } },
        {
          $set: {
            status,
            releasedAt,
            activeUserKey: null,
            activePayoutId: null
          }
        },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }

  /**
   * Hands a top-up to an operator.
   *
   * Frees the *user* lock but keeps the payout one: we are still holding
   * somebody's payout, and it must not be offered again — while the person who
   * already paid into it should not be locked out of topping up meanwhile.
   */
  /**
   * Top-ups under review that have been held longer than `cutoff`.
   *
   * Measured from `createdAt` — the top-up's own start — because what is being
   * timed is how long a Transacto payout has been ours, and that clock starts
   * when the payout is taken. It is also the only timestamp here that never
   * moves: `updatedAt` shifts on every write, including the sweep's own refresh
   * of `coveredUah`, which would push the deadline away each time it looked.
   *
   * One query for two deadlines. The caller asks for everything past the
   * earlier one — when an operator is told — and decides per record whether the
   * later one, when an empty payout is given back, has also passed.
   */
  async findReviewsOlderThan(cutoff: Date): Promise<TmaFiatDepositRecord[]> {
    return this.fiatDepositModel
      .find({ status: TmaFiatDepositStatus.REVIEW, createdAt: { $lte: cutoff } })
      .sort({ createdAt: 1 })
      .lean<TmaFiatDepositRecord[]>()
  }

  /**
   * Replaces our tally of what has been paid in with what Transacto reports.
   *
   * `$set`, unlike {@link markReceiptAccepted}'s `$inc`: this is not another
   * receipt arriving, it is the counterparty's own figure replacing a number we
   * stopped maintaining. A top-up under review is outside every other pass, so
   * its `coveredUah` is frozen at the moment it was flagged — and a transfer
   * that landed afterwards would otherwise never be counted.
   *
   * Guarded on REVIEW so it can only ever touch the rows nothing else does.
   */
  async setCoveredFromUpstream(id: string, coveredUah: number): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: TmaFiatDepositStatus.REVIEW },
        { $set: { coveredUah } },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }

  async markForReview(id: string): Promise<TmaFiatDepositRecord | null> {
    return this.fiatDepositModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: { $in: LIVE_FIAT_DEPOSIT_STATUSES } },
        // **`activeUserKey` is deliberately left alone.**
        //
        // It used to be cleared here, which freed the user to start another
        // top-up while this one's payout was still held — and `activePayoutId`
        // stays, so the payout really was still ours. One user reached two held
        // payouts that way, each on its own Transacto SLA clock, and the second
        // was taken fifteen hours after the first went under review.
        //
        // The harm is the one the index's own comment names: two payouts in one
        // person's name make the next receipt matchable to either. A review is
        // an unfinished top-up, so it holds the user's slot like any other; the
        // ninety-minute sweep is what stops that being for ever.
        { $set: { status: TmaFiatDepositStatus.REVIEW } },
        { returnDocument: 'after' }
      )
      .lean<TmaFiatDepositRecord>()
  }
}
