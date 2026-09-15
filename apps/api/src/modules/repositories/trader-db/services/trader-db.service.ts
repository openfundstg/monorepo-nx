import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { QueryFilter, Model, Types } from 'mongoose'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { Trader, TraderDocument } from '../schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** A lean trader plus its id — what every read here actually returns. */
export type StoredTrader = Trader & { _id: Types.ObjectId }

@Injectable()
export class TraderDbService {
  constructor(
    @InjectModel(Trader.name) private readonly traderModel: Model<TraderDocument>,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async findAllActive(): Promise<Trader[]> {
    return this.traderModel.find({ isActive: true }).lean()
  }

  async findByTraderId(traderId: number): Promise<StoredTrader | null> {
    return this.traderModel.findOne({ traderId }).lean()
  }

  async findByApiToken(apiToken: string): Promise<Trader | null> {
    return this.traderModel.findOne({ apiToken }).lean()
  }

  async upsert(traderId: number, apiToken: string): Promise<Trader> {
    return this.traderModel
      .findOneAndUpdate(
        { traderId },
        { traderId, apiToken, isActive: true },
        { upsert: true, returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * BEHAVIOUR FIX. The old `post('save')` / `post('findOneAndUpdate')` schema
   * hooks emitted TRADER_DEACTIVATED when a trader became inactive, but neither
   * ever ran: this is the only deactivation path and it uses `updateOne`, which
   * triggers neither. There is no `.save()` on Trader anywhere, and `upsert()`
   * always sets isActive: true. So the event never reached the extension, even
   * though it subscribes to it.
   *
   * Emitting here restores the hook's evident intent.
   */
  async deactivateTrader(traderId: number): Promise<void> {
    await this.traderModel.updateOne({ traderId }, { $set: { isActive: false } })

    this.eventEmitter.emit(
      'ws.emit',
      new TraderWsEvent(traderId, WsEventNames.TRADER_DEACTIVATED, { traderId })
    )
  }

  async activateTrader(traderId: number): Promise<void> {
    await this.traderModel.updateOne({ traderId }, { $set: { isActive: true } })
  }

  /**
   * One page of traders.
   *
   * The projection drops `apiToken` at the database rather than in the mapper
   * above it. That token authenticates the extension as its trader, so a leak
   * turns read access to the panel into full impersonation — and a field that
   * never leaves Mongo cannot be forgotten in a later refactor of whoever maps
   * this to a DTO.
   */
  async findPage(
    filter: QueryFilter<Trader>,
    page: PageQuery
  ): Promise<Page<Omit<Trader, 'apiToken'> & { _id: Types.ObjectId; createdAt: Date }>> {
    const [items, total] = await Promise.all([
      this.traderModel
        .find(filter, { apiToken: 0 })
        .sort(page.sort)
        .skip(page.skip)
        .limit(page.limit)
        .lean(),
      this.traderModel.countDocuments(filter)
    ])

    return {
      items: items as unknown as (Omit<Trader, 'apiToken'> & {
        _id: Types.ObjectId
        createdAt: Date
      })[],
      total
    }
  }
}
