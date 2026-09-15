import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import { SupportLocale } from 'src/shared/constants'
import { SupportBotUser, SupportBotUserDocument } from 'src/modules/repositories/support-db/schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

export type StoredSupportBotUser = SupportBotUser & { _id: Types.ObjectId }

/** The profile fields Telegram sends with every update, as this layer takes them. */
export interface SupportBotUserProfile {
  readonly firstName: string
  readonly lastName: string
  readonly username: string
  readonly languageCode: string
}

@Injectable()
export class SupportBotUserDbService {
  constructor(
    @InjectModel(SupportBotUser.name)
    private readonly userModel: Model<SupportBotUserDocument>
  ) {}

  async findByTelegramId(telegramId: number): Promise<StoredSupportBotUser | null> {
    return this.userModel.findOne({ telegramId }).lean()
  }

  /**
   * Records the profile behind an update and returns the row as it now stands.
   *
   * An upsert rather than a find-then-create because it runs on *every* update:
   * the row has to exist before a language can be remembered against it, and a
   * read plus a conditional insert would race with itself the moment a user
   * taps two buttons quickly.
   *
   * `preferredLocale` is untouched on purpose — it is the one field on this
   * document Telegram does not own, and `$setOnInsert` is what keeps a chosen
   * language from being reset to `null` by the next message that arrives.
   */
  async upsertProfile(
    telegramId: number,
    profile: SupportBotUserProfile
  ): Promise<StoredSupportBotUser> {
    return this.userModel
      .findOneAndUpdate(
        { telegramId },
        {
          $set: { ...profile, lastSeenAt: new Date() },
          $setOnInsert: { telegramId, preferredLocale: null }
        },
        // `returnDocument`, not `new`: Mongoose 9 deprecates the latter and
        // prints a warning on every single update — and this runs once per
        // inbound Telegram update.
        { upsert: true, returnDocument: 'after', lean: true }
      )
      .lean()
      .then((user) => user as StoredSupportBotUser)
  }

  /** Records a language chosen by hand. It outranks whatever Telegram reports. */
  async setPreferredLocale(telegramId: number, locale: SupportLocale): Promise<void> {
    await this.userModel.updateOne({ telegramId }, { $set: { preferredLocale: locale } })
  }

  /** One page of everyone who has written to the bot, for the admin panel. */
  async findPage(
    filter: QueryFilter<SupportBotUser>,
    page: PageQuery
  ): Promise<Page<StoredSupportBotUser>> {
    const [items, total] = await Promise.all([
      this.userModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.userModel.countDocuments(filter)
    ])

    return { items, total }
  }
}
