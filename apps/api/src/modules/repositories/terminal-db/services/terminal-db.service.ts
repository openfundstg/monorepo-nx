import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Model,
  ProjectionType,
  Query,
  QueryFilter,
  QueryOptions,
  UpdateQuery,
  UpdateWithAggregationPipeline
} from 'mongoose'
import { UpdateOptions } from 'mongodb'
import { Types } from 'mongoose'
import { TerminalSource } from '@transacto/contracts'
import { Terminal, TerminalDocument } from '../schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** A lean terminal plus its id — what every read here actually returns. */
export type StoredTerminal = Terminal & { _id: Types.ObjectId }

@Injectable()
export class TerminalDbService {
  constructor(
    @InjectModel(Terminal.name)
    private readonly terminalModel: Model<TerminalDocument>
  ) {}

  readonly findOne = (
    query: QueryFilter<Terminal>,
    projection?: ProjectionType<Terminal>,
    options?: QueryOptions<Terminal>
  ) => this.terminalModel.findOne(query, projection, options).lean()

  readonly find = (query: QueryFilter<TerminalDocument>) => this.terminalModel.find(query).lean()

  /**
   * Like {@link find}, but bounded and ordered.
   *
   * The extension's terminal search matches on a regex over every terminal a
   * trader owns, disabled ones included, and ranks the hits in the service. An
   * unbounded `find` there would load a whole account into memory to show
   * twenty rows; newest-first means the cap, when it is reached, drops the
   * terminals least likely to be the one being looked for.
   */
  readonly findLimited = (query: QueryFilter<Terminal>, limit: number) =>
    this.terminalModel.find(query).sort({ updatedAt: -1 }).limit(limit).lean()

  /** How many terminals match, so a truncated result can say it is truncated. */
  readonly count = (query: QueryFilter<Terminal>) => this.terminalModel.countDocuments(query)

  readonly updateOne = (
    query: QueryFilter<Terminal>,
    update: UpdateQuery<Terminal> | UpdateWithAggregationPipeline,
    options?: UpdateOptions
  ) => this.terminalModel.updateOne(query, update, options)

  readonly bulkWrite = (ops: any[]) => this.terminalModel.bulkWrite(ops)

  readonly upsert = (
    query: QueryFilter<Terminal>,
    update: UpdateQuery<Terminal> | UpdateWithAggregationPipeline
  ) => this.terminalModel.updateOne(query, update, { upsert: true })

  /**
   * One page of terminals across every trader, plus the size of the match.
   *
   * The other reads here are all scoped to one trader by their caller; this one
   * deliberately is not, which is why it exists separately rather than as a
   * default argument on {@link findLimited}. Only the admin panel has any
   * business calling it.
   */
  readonly findPage = async (
    query: QueryFilter<Terminal>,
    page: PageQuery
  ): Promise<Page<StoredTerminal>> => {
    const [items, total] = await Promise.all([
      this.terminalModel.find(query).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.terminalModel.countDocuments(query)
    ])

    return { items, total }
  }

  /**
   * How many terminals each of these traders owns, and how many are enabled.
   *
   * One aggregation for a whole page of traders — the alternative is two counts
   * per row.
   */
  readonly countByTraderIds = async (
    traderIds: readonly number[]
  ): Promise<Record<number, { total: number; enabled: number }>> => {
    if (!traderIds.length) return {}

    const rows = await this.terminalModel
      .aggregate<{ _id: number; total: number; enabled: number }>([
        { $match: { traderId: { $in: [...traderIds] } } },
        {
          $group: {
            _id: '$traderId',
            total: { $sum: 1 },
            enabled: { $sum: { $cond: ['$enabled', 1, 0] } }
          }
        }
      ])
      .exec()

    return Object.fromEntries(
      rows.map((row) => [row._id, { total: row.total, enabled: row.enabled }])
    )
  }

  /**
   * Which of these cards belong to Mini App terminals.
   *
   * `source` is re-classified on every terminals sync, so it is present on
   * every row a sync has touched and a stored value can be trusted here.
   */
  async findTmaCardIds(cardIds: readonly number[]): Promise<number[]> {
    if (!cardIds.length) return []

    return this.terminalModel
      .distinct('cardId', { cardId: { $in: [...cardIds] }, source: TerminalSource.TMA })
      .exec()
  }

  /** Totals for the overview: how many exist, how many are live, how many still route. */
  readonly countStates = async (): Promise<{
    total: number
    enabled: number
    acceptingOrders: number
  }> => {
    const [totals] = await this.terminalModel
      .aggregate<{ total: number; enabled: number; acceptingOrders: number }>([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            enabled: { $sum: { $cond: ['$enabled', 1, 0] } },
            // `acceptingOrders` post-dates the collection, and a lean read
            // applies no Mongoose default — so a missing field has to be read
            // as `true`, which is what those terminals were doing.
            // Enabled ones only: a teardown resets the flag to `true`, so on a
            // disabled terminal it says nothing, and counting it reported every
            // dead jar as still taking payers.
            acceptingOrders: {
              $sum: {
                $cond: [{ $and: ['$enabled', { $ne: ['$acceptingOrders', false] }] }, 1, 0]
              }
            }
          }
        },
        { $project: { _id: 0, total: 1, enabled: 1, acceptingOrders: 1 } }
      ])
      .exec()

    return totals ?? { total: 0, enabled: 0, acceptingOrders: 0 }
  }
}
