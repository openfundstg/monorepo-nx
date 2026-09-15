import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import type { TerminalHistoryAlertType } from '@transacto/contracts'
import { TerminalHistory, TerminalHistoryDocument } from '../schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/**
 * Persistence only. The `terminal.state_changed` handler, the pending-order
 * arithmetic and the TERMINAL_HISTORY_UPDATED emission that used to live here
 * (and in a schema hook) now sit in TerminalHistoryService.
 */
@Injectable()
export class TerminalHistoryDbService {
  constructor(
    @InjectModel(TerminalHistory.name)
    private readonly terminalHistoryModel: Model<TerminalHistoryDocument>
  ) {}

  async create(data: Partial<TerminalHistory>): Promise<TerminalHistoryDocument> {
    const log = new this.terminalHistoryModel(data)
    return log.save()
  }

  async getHistoryForCard(
    traderId: number,
    cardId: number,
    limit = 50
  ): Promise<TerminalHistory[]> {
    return this.terminalHistoryModel
      .find({ traderId, cardId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
  }

  /**
   * One page of history rows, for the admin panel.
   *
   * Separate from {@link getHistoryForCard}, which answers the extension's
   * fixed "last 50 for this jar" and needs no total. This one is filtered by
   * the caller and counted, because the panel pages through it.
   */
  async findPage(
    filter: QueryFilter<TerminalHistory>,
    page: PageQuery
  ): Promise<Page<TerminalHistory & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.terminalHistoryModel
        .find(filter)
        .sort(page.sort)
        .skip(page.skip)
        .limit(page.limit)
        .lean(),
      this.terminalHistoryModel.countDocuments(filter)
    ])

    return { items: items as (TerminalHistory & { _id: Types.ObjectId })[], total }
  }
  /**
   * Rewrites one alert classification, wherever it sits in an entry's array.
   *
   * `arrayFilters` rather than a positional `$`, because one entry may carry
   * several alerts and `$` updates only the first match. The trader's feed
   * renders these by concatenating the type onto a translation key, so a stale
   * one shows as a raw string. Idempotent: the old value is the filter.
   */
  async renameAlertType(from: string, to: TerminalHistoryAlertType): Promise<number> {
    const { modifiedCount } = await this.terminalHistoryModel.updateMany(
      { 'alerts.type': from } as QueryFilter<TerminalHistory>,
      { $set: { 'alerts.$[stale].type': to } },
      { arrayFilters: [{ 'stale.type': from }] }
    )

    return modifiedCount ?? 0
  }

}
