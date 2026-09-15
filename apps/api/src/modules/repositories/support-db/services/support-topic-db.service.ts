import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import { SupportTopicStatus, SupportTopicTitleState } from 'src/shared/constants'
import { SupportTopic, SupportTopicDocument } from 'src/modules/repositories/support-db/schemas'
import { isDuplicateKeyOn } from 'src/shared/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** A lean topic document plus its id — what every read path here returns. */
export type StoredSupportTopic = SupportTopic & { _id: Types.ObjectId }

@Injectable()
export class SupportTopicDbService {
  private readonly logger = new Logger(SupportTopicDbService.name)

  constructor(
    @InjectModel(SupportTopic.name)
    private readonly topicModel: Model<SupportTopicDocument>
  ) {}

  async findByTelegramId(telegramId: number): Promise<StoredSupportTopic | null> {
    return this.topicModel.findOne({ telegramId }).lean()
  }

  async findByThreadId(messageThreadId: number): Promise<StoredSupportTopic | null> {
    return this.topicModel.findOne({ messageThreadId }).lean()
  }

  /**
   * Records a freshly created forum topic for a user.
   *
   * Returns the row that ended up in the collection, which is not necessarily
   * the one this call wrote: two racing creates both reach here, and the loser
   * gets back the winner's row rather than an exception. The caller has already
   * serialised on a Redis lock, so this is the second line of defence — the one
   * that still holds if the lock expired mid-flight or Redis was restarted.
   */
  async createTopic(
    telegramId: number,
    messageThreadId: number,
    displayName: string
  ): Promise<StoredSupportTopic> {
    try {
      const created = await this.topicModel.create({
        telegramId,
        messageThreadId,
        displayName,
        titleWritten: displayName,
        // A topic only ever comes into being because somebody wrote in, so it
        // is waiting on an operator from its first second.
        titleState: SupportTopicTitleState.OPEN,
        status: SupportTopicStatus.OPEN
      })

      return created.toObject()
    } catch (error) {
      if (!isDuplicateKeyOn(error, 'telegramId')) throw error

      this.logger.warn(
        `Support topic for ${telegramId} was created concurrently; keeping the existing row`
      )
      const existing = await this.topicModel.findOne({ telegramId }).lean()

      // Only reachable if the row were deleted between the failed insert and
      // this read, which nothing does. Rethrowing keeps the impossible case
      // loud instead of returning a fabricated document.
      if (!existing) throw error

      return existing
    }
  }

  /**
   * Repoints a user at a new thread after their old one stopped existing.
   *
   * Separate from {@link createTopic} because the row must not be recreated:
   * `createdAt` and the message timestamps are the history of a conversation
   * that continues, even though Telegram's side of it was deleted.
   */
  async replaceThread(
    telegramId: number,
    messageThreadId: number,
    displayName: string
  ): Promise<void> {
    await this.topicModel.updateOne(
      { telegramId },
      {
        $set: {
          messageThreadId,
          displayName,
          titleWritten: displayName,
          titleState: SupportTopicTitleState.OPEN,
          status: SupportTopicStatus.OPEN,
          closedAt: null
        }
      }
    )
  }

  /** Stamps the user's latest message. The profile behind it lives on `support_bot_users`. */
  async touchUserMessage(telegramId: number): Promise<void> {
    await this.topicModel.updateOne({ telegramId }, { $set: { lastUserMessageAt: new Date() } })
  }

  async touchAdminMessage(messageThreadId: number): Promise<void> {
    await this.topicModel.updateOne(
      { messageThreadId },
      { $set: { lastAdminMessageAt: new Date() } }
    )
  }

  async markOpen(telegramId: number): Promise<void> {
    await this.topicModel.updateOne(
      { telegramId },
      { $set: { status: SupportTopicStatus.OPEN, closedAt: null } }
    )
  }

  /**
   * Marks a topic open when only its thread id is known.
   *
   * The sibling {@link markOpen} is keyed by user because it runs on the path
   * that has a user; this one runs after Telegram reports a thread was closed
   * behind our back, where the thread is all there is.
   */
  async markOpenByThreadId(messageThreadId: number): Promise<void> {
    await this.topicModel.updateOne(
      { messageThreadId },
      { $set: { status: SupportTopicStatus.OPEN, closedAt: null } }
    )
  }

  async markClosed(messageThreadId: number): Promise<void> {
    await this.topicModel.updateOne(
      { messageThreadId },
      { $set: { status: SupportTopicStatus.CLOSED, closedAt: new Date() } }
    )
  }

  /**
   * Records the title actually written to Telegram.
   *
   * Both halves at once, because they are written to Telegram as one string: a
   * row claiming a state the title does not show would suppress the rename that
   * was supposed to fix it.
   */
  async setTitle(
    telegramId: number,
    displayName: string,
    titleState: SupportTopicTitleState
  ): Promise<void> {
    await this.topicModel.updateOne(
      { telegramId },
      { $set: { displayName, titleWritten: displayName, titleState } }
    )
  }

  /** One page of support threads, for the admin panel. */
  async findPage(
    filter: QueryFilter<SupportTopic>,
    page: PageQuery
  ): Promise<Page<StoredSupportTopic>> {
    const [items, total] = await Promise.all([
      this.topicModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.topicModel.countDocuments(filter)
    ])

    return { items, total }
  }
}
