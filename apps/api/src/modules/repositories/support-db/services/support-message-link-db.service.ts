import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  SupportMessageLink,
  SupportMessageLinkDocument
} from 'src/modules/repositories/support-db/schemas'
import { isDuplicateKeyOn } from 'src/shared/utils'

@Injectable()
export class SupportMessageLinkDbService {
  private readonly logger = new Logger(SupportMessageLinkDbService.name)

  constructor(
    @InjectModel(SupportMessageLink.name)
    private readonly linkModel: Model<SupportMessageLinkDocument>
  ) {}

  /**
   * Records that one message now exists on both sides.
   *
   * A duplicate is swallowed rather than thrown: the pair it would have written
   * is already there, which means the same message was relayed twice, and
   * failing here would turn a redelivery Telegram already handled into a lost
   * message.
   */
  async link(
    telegramId: number,
    messageThreadId: number,
    userMessageId: number,
    groupMessageId: number
  ): Promise<void> {
    try {
      await this.linkModel.create({ telegramId, messageThreadId, userMessageId, groupMessageId })
    } catch (error) {
      if (
        !isDuplicateKeyOn(error, 'userMessageId') &&
        !isDuplicateKeyOn(error, 'groupMessageId')
      )
        throw error

      this.logger.debug(`Message link ${userMessageId}↔${groupMessageId} already recorded`)
    }
  }

  /** The group-side id of a message the user is replying to. */
  async findGroupMessageId(telegramId: number, userMessageId: number): Promise<number | null> {
    const link = await this.linkModel.findOne({ telegramId, userMessageId }).lean()

    return link?.groupMessageId ?? null
  }

  /** The user-side id of a message an operator is replying to. */
  async findUserMessageId(groupMessageId: number): Promise<number | null> {
    const link = await this.linkModel.findOne({ groupMessageId }).lean()

    return link?.userMessageId ?? null
  }
}
