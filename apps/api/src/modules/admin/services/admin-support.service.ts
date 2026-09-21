import type {
  AdminPageReq,
  AdminPaginatedRes,
  AdminSupportTopicListItem,
  AdminSupportUserListItem
} from '@transacto/contracts'
import { Injectable } from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import {
  SupportBotUserDbService,
  SupportTopicDbService
} from 'src/modules/repositories/support-db/services'
import type { SupportBotUser, SupportTopic } from 'src/modules/repositories/support-db/schemas'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { containsRegex } from 'src/shared/utils'
import {
  toAdminSupportTopic,
  toAdminSupportUser,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'

/**
 * The support bot's own two collections.
 *
 * Read-only. Replying to somebody happens in the Telegram supergroup, where the
 * thread and its attachments already live — a second reply surface in the panel
 * would be a second place a message can be sent from, with no way to keep the
 * two conversations in one order.
 */
@Injectable()
export class AdminSupportService {
  constructor(
    private readonly topicDbService: SupportTopicDbService,
    private readonly botUserDbService: SupportBotUserDbService,
    private readonly tmaUserDbService: TmaUserDbService
  ) {}

  async listTopics(request: AdminPageReq): Promise<AdminPaginatedRes<AdminSupportTopicListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.topicDbService.findPage(
      this.topicFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.SUPPORT_TOPICS, 'updatedAt')
    )

    return toPaginatedRes(page, paging, toAdminSupportTopic)
  }

  /**
   * Everyone who has written to the bot, flagged with whether they also have a
   * Mini App account.
   *
   * The flag is one query for the page, not one per row — and it is a lookup
   * rather than a field because the two collections are joined on `telegramId`
   * and nothing enforces that a bot user has an account at all.
   */
  async listUsers(request: AdminPageReq): Promise<AdminPaginatedRes<AdminSupportUserListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.botUserDbService.findPage(
      this.userFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.SUPPORT_USERS)
    )

    const tmaUsers = await this.tmaUserDbService.findManyByTelegramIds(
      page.items.map((user) => user.telegramId)
    )
    const known = new Set(tmaUsers.map((user) => user.telegramId))

    return toPaginatedRes(page, paging, (user) =>
      toAdminSupportUser(user, known.has(user.telegramId))
    )
  }

  private topicFilter(search: string | undefined): QueryFilter<SupportTopic> {
    if (!search) return {}

    const asNumber = Number(search)

    return {
      $or: [
        { displayName: containsRegex(search) },
        ...(Number.isFinite(asNumber)
          ? [{ telegramId: asNumber }, { messageThreadId: asNumber }]
          : [])
      ]
    }
  }

  private userFilter(search: string | undefined): QueryFilter<SupportBotUser> {
    if (!search) return {}

    const pattern = containsRegex(search)
    const asNumber = Number(search)

    return {
      $or: [
        { username: pattern },
        { firstName: pattern },
        { lastName: pattern },
        ...(Number.isFinite(asNumber) ? [{ telegramId: asNumber }] : [])
      ]
    }
  }
}
