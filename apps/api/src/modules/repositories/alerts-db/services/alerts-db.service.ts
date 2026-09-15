import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Model, QueryFilter, Types, UpdateQuery } from 'mongoose'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { Alert, AlertDocument, AlertStatus } from '../schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

@Injectable()
export class AlertDbService {
  constructor(
    @InjectModel(Alert.name) private readonly alertModel: Model<AlertDocument>,
    private readonly eventEmitter: EventEmitter2
  ) {}

  readonly findOne = <T = AlertDocument>(
    query: QueryFilter<AlertDocument>,
    projection?: any,
    options?: any
  ): Promise<T | null> =>
    this.alertModel.findOne(query, projection, options).lean() as unknown as Promise<T | null>

  readonly find = <T = AlertDocument>(
    query: QueryFilter<AlertDocument>,
    projection?: any,
    options?: any
  ): Promise<T[]> =>
    this.alertModel.find(query, projection, options).lean() as unknown as Promise<T[]>

  readonly countDocuments = (query: QueryFilter<AlertDocument>): Promise<number> =>
    this.alertModel.countDocuments(query)

  /** Never fired the old hook (updateMany triggers no document middleware), so it still does not emit. */
  readonly updateMany = (
    query: QueryFilter<AlertDocument>,
    update: UpdateQuery<AlertDocument>,
    options?: any
  ) => this.alertModel.updateMany(query, update, options)

  readonly findByIdAndUpdate = async <T = AlertDocument>(
    id: string,
    update: UpdateQuery<AlertDocument>,
    options?: any
  ): Promise<T | null> => {
    const doc = (await this.alertModel
      .findByIdAndUpdate(id, update, { ...options, returnDocument: 'after' })
      .lean()) as AlertDocument | null

    this.emitAlertEvent(doc)

    return doc as unknown as T | null
  }

  readonly create = async <T = AlertDocument>(doc: Partial<Alert>): Promise<T> => {
    const created = await this.alertModel.create(doc)
    const plain = created.toObject() as AlertDocument

    this.emitAlertEvent(plain)

    return plain as unknown as T
  }

  /**
   * Was a `post('save')` / `post('findOneAndUpdate')` schema hook. `create()`
   * and `findByIdAndUpdate()` are exactly the two paths that triggered it —
   * `create` goes through save(), and findByIdAndUpdate delegates to
   * findOneAndUpdate — so the emission conditions are unchanged.
   *
   * Payload also unchanged: the whole document plus `id` and `alertId`, both the
   * stringified _id. Typed as TerminalAlertDto in @transacto/contracts.
   */
  private emitAlertEvent(doc: AlertDocument | null): void {
    if (!doc) return

    const payload = {
      ...doc,
      id: doc._id.toString(),
      alertId: doc._id.toString()
    }

    if (doc.status === AlertStatus.PENDING) {
      this.eventEmitter.emit(
        'ws.emit',
        new TraderWsEvent(doc.traderId, WsEventNames.TERMINAL_ALERT_TRIGGERED, payload)
      )
    } else if (doc.status === AlertStatus.RESOLVED) {
      this.eventEmitter.emit(
        'ws.emit',
        new TraderWsEvent(doc.traderId, WsEventNames.TERMINAL_ALERT_RESOLVED, payload)
      )
    }
  }

  /** One page of alerts across every trader — the admin panel's only read here. */
  readonly findPage = async (
    query: QueryFilter<AlertDocument>,
    page: PageQuery
  ): Promise<Page<Alert & { _id: Types.ObjectId }>> => {
    const [items, total] = await Promise.all([
      this.alertModel.find(query).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.alertModel.countDocuments(query)
    ])

    return { items: items as unknown as (Alert & { _id: Types.ObjectId })[], total }
  }

  /**
   * How many alerts are still pending for each of these traders.
   *
   * One aggregation for a page of traders, rather than a count per row.
   */
  readonly countPendingByTraderIds = async (
    traderIds: readonly number[]
  ): Promise<Record<number, number>> => {
    if (!traderIds.length) return {}

    const rows = await this.alertModel
      .aggregate<{ _id: number; count: number }>([
        { $match: { traderId: { $in: [...traderIds] }, status: AlertStatus.PENDING } },
        { $group: { _id: '$traderId', count: { $sum: 1 } } }
      ])
      .exec()

    return Object.fromEntries(rows.map((row) => [row._id, row.count]))
  }

  /**
   * Removes one alert permanently.
   *
   * The only delete in this repository, and the first: nothing in the product
   * ever removed an alert, because an alert records a discrepancy in somebody's
   * money and the record is the point. It exists for the admin panel, whose
   * caller copies the whole row onto an audit entry before calling this — the
   * list loses it, the trail does not.
   *
   * Returns the document as it was, so the caller has something to record.
   */
  readonly deleteById = async (id: string): Promise<Alert | null> =>
    this.alertModel.findByIdAndDelete(id).lean() as unknown as Promise<Alert | null>
}
