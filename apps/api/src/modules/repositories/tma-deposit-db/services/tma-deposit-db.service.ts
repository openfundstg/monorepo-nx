import { ERROR } from '@transacto/contracts'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import {
  CREDITED_DEPOSIT_STATUSES,
  TmaDeposit,
  TmaDepositDocument,
  TmaDepositStatus
} from 'src/modules/repositories/tma-deposit-db/schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/**
 * What the credited USDT was worth in hryvnia at the moment it was credited.
 *
 * Written in the same update as the status, never afterwards: a deposit that is
 * credited without its valuation is a row nothing can price later, because the
 * rate it would have been priced at has moved on by then.
 */
export interface CreditedValuation {
  /** Buy rate at the credit, in kopecks per USDT. */
  readonly creditedExchangeRate: number
  /** Hryvnia kopecks the credited USDT was worth at that rate. */
  readonly creditedFiatEquivalent: number
}

@Injectable()
export class TmaDepositDbService {
  private readonly logger = new Logger(TmaDepositDbService.name)

  constructor(
    @InjectModel(TmaDeposit.name)
    private readonly depositModel: Model<TmaDepositDocument>
  ) {}

  async create(data: {
    telegramId: number
    cryptoAmount: number
    fiatEquivalent: number
    exchangeRate: number
    expiresAt: Date
  }): Promise<TmaDeposit & { _id: any }> {
    const deposit = await this.depositModel.create(data)
    return deposit.toObject()
  }

  async findById(id: string): Promise<(TmaDeposit & { _id: any }) | null> {
    return this.depositModel.findById(id).lean()
  }

  /** One user's deposits, newest first; unbounded when no limit is given. */
  async findByTelegramId(
    telegramId: number,
    limit?: number
  ): Promise<(TmaDeposit & { _id: any })[]> {
    const query = this.depositModel.find({ telegramId }).sort({ createdAt: -1 })

    return (limit === undefined ? query : query.limit(limit)).lean()
  }

  /** Whether this user has a USDT deposit still waiting for its transfer. */
  async hasPending(telegramId: number): Promise<boolean> {
    return (
      (await this.depositModel.exists({ telegramId, status: TmaDepositStatus.PENDING })) !== null
    )
  }

  async findPendingDeposits(): Promise<(TmaDeposit & { _id: any })[]> {
    return this.depositModel.find({ status: TmaDepositStatus.PENDING }).lean()
  }

  /**
   * Marks a deposit as COMPLETED with its verified TxID.
   */
  async markCompleted(
    id: string,
    txId: string,
    verifiedAt: Date,
    valuation: CreditedValuation
  ): Promise<TmaDeposit & { _id: any }> {
    const result = await this.depositModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: TmaDepositStatus.COMPLETED,
            txId,
            verifiedAt,
            ...valuation
          }
        },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.DEPOSIT.NOT_FOUND)
    return result
  }

  /**
   * Marks a deposit as PAID_LATE — valid TxID submitted after expiry.
   * Balance is still credited per approved policy.
   */
  async markPaidLate(
    id: string,
    txId: string,
    verifiedAt: Date,
    valuation: CreditedValuation
  ): Promise<TmaDeposit & { _id: any }> {
    const result = await this.depositModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: TmaDepositStatus.PAID_LATE,
            txId,
            verifiedAt,
            ...valuation
          }
        },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.DEPOSIT.NOT_FOUND)
    return result
  }

  /**
   * Checks if a TxID has already been submitted (anti-double-spend).
   */
  async isTxIdUsed(txId: string): Promise<boolean> {
    const existing = await this.depositModel.findOne({ txId }).lean()
    return !!existing
  }

  /**
   * Bulk-expire all PENDING deposits past their expiresAt.
   * Returns the IDs of newly expired deposits for WS notification.
   */
  async expireStaleDeposits(): Promise<{ id: string; telegramId: number }[]> {
    const now = new Date()

    // First, find deposits that will be expired (for notification)
    const staleDeposits = await this.depositModel
      .find({
        status: TmaDepositStatus.PENDING,
        expiresAt: { $lte: now }
      })
      .select('_id telegramId')
      .lean()

    if (staleDeposits.length === 0) return []

    // Bulk update
    await this.depositModel.updateMany(
      {
        status: TmaDepositStatus.PENDING,
        expiresAt: { $lte: now }
      },
      { $set: { status: TmaDepositStatus.EXPIRED } }
    )

    this.logger.log(`Expired ${staleDeposits.length} stale deposits`)

    return staleDeposits.map((d) => ({
      id: d._id.toString(),
      telegramId: d.telegramId
    }))
  }

  // --- Admin reads ----------------------------------------------------------

  async findPage(
    filter: QueryFilter<TmaDeposit>,
    page: PageQuery
  ): Promise<Page<TmaDeposit & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.depositModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.depositModel.countDocuments(filter)
    ])

    return { items, total }
  }

  async count(filter: QueryFilter<TmaDeposit> = {}): Promise<number> {
    return this.depositModel.countDocuments(filter)
  }

  /**
   * Whether this user has ever had a crypto deposit credited.
   *
   * `exists` rather than a count or a sum: the caller asks a yes/no question —
   * the hryvnia top-up ceiling lifts on the first one — and Mongo can stop at
   * the first matching document instead of walking a heavy user's whole history
   * to produce a number nobody reads.
   */
  async hasCredited(telegramId: number): Promise<boolean> {
    const found = await this.depositModel.exists({
      telegramId,
      status: { $in: CREDITED_DEPOSIT_STATUSES }
    })

    return found !== null
  }

  /**
   * One user's lifetime credited deposits, in whole USDT.
   *
   * An aggregation and not a sum over a page: the detail screen embeds only the
   * ten most recent deposits, so adding those up would silently understate
   * every user with more than ten — and understate it by more the longer they
   * stay.
   *
   * `PAID_LATE` counts alongside `COMPLETED` for the same reason it does in
   * {@link verifiedSince}: the money arrived and was credited.
   */
  async sumCreditedForUser(telegramId: number): Promise<number> {
    const [totals] = await this.depositModel
      .aggregate<{ credited: number }>([
        {
          $match: {
            telegramId,
            status: { $in: CREDITED_DEPOSIT_STATUSES }
          }
        },
        { $group: { _id: null, credited: { $sum: '$cryptoAmount' } } },
        { $project: { _id: 0, credited: 1 } }
      ])
      .exec()

    return totals?.credited ?? 0
  }

  /**
   * Deposits verified since a moment, counted and summed.
   *
   * `PAID_LATE` counts alongside `COMPLETED`: the money arrived and was
   * credited, and an overview that reported only the punctual ones would
   * understate the day's intake.
   */
  async verifiedSince(since: Date): Promise<{ count: number; credited: number }> {
    const [totals] = await this.depositModel
      .aggregate<{ count: number; credited: number }>([
        {
          $match: {
            status: { $in: CREDITED_DEPOSIT_STATUSES },
            verifiedAt: { $gte: since }
          }
        },
        { $group: { _id: null, count: { $sum: 1 }, credited: { $sum: '$cryptoAmount' } } },
        { $project: { _id: 0, count: 1, credited: 1 } }
      ])
      .exec()

    return totals ?? { count: 0, credited: 0 }
  }
}
