import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import { SafeBoxDeposit, SafeBoxDepositDocument, SafeBoxStatus } from '../schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

@Injectable()
export class SafeBoxDbService {
  constructor(
    @InjectModel(SafeBoxDeposit.name)
    private readonly safeBoxModel: Model<SafeBoxDepositDocument>
  ) {}

  async create(data: Partial<SafeBoxDeposit>): Promise<SafeBoxDepositDocument> {
    const deposit = new this.safeBoxModel(data)
    return deposit.save()
  }

  async findByTerminal(terminalId: number): Promise<SafeBoxDeposit[]> {
    return this.safeBoxModel.find({ terminalId }).sort({ createdAt: -1 }).lean()
  }

  async updateStatus(
    id: string,
    status: SafeBoxStatus,
    linkedOrderId?: number,
    comment?: string
  ): Promise<SafeBoxDepositDocument | null> {
    const update: Partial<SafeBoxDeposit> = { status }
    if (linkedOrderId !== undefined) update.linkedOrderId = linkedOrderId
    if (comment !== undefined) update.comment = comment

    return this.safeBoxModel.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' })
  }

  async findAll(
    traderId: number,
    query: {
      term?: string
      status?: SafeBoxStatus
      page?: number
      limit?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
    }
  ): Promise<{ data: SafeBoxDeposit[]; total: number }> {
    const { term, status, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const filter: Record<string, unknown> = { traderId }

    if (term) {
      const termAsNumber = Number(term)
      if (!isNaN(termAsNumber)) {
        filter.$or = [
          { terminalId: termAsNumber },
          { linkedOrderId: termAsNumber },
          { amount: termAsNumber }
        ]
      }
    }

    if (status) filter.status = status

    const skip = (page - 1) * limit
    const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'desc' ? -1 : 1 }

    const [data, total] = await Promise.all([
      this.safeBoxModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      this.safeBoxModel.countDocuments(filter)
    ])

    return { data, total }
  }

  /**
   * One page of held deposits across every trader.
   *
   * Distinct from {@link findAll}, which is the extension's own view and is
   * scoped to the calling trader by its first argument. The admin panel needs
   * the unscoped version, and giving `findAll` an optional trader would make a
   * missing argument mean "everybody's money" — the wrong default for that
   * call site to have.
   */
  async findPage(
    filter: QueryFilter<SafeBoxDeposit>,
    page: PageQuery
  ): Promise<Page<SafeBoxDeposit & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.safeBoxModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.safeBoxModel.countDocuments(filter)
    ])

    return { items, total }
  }
}
