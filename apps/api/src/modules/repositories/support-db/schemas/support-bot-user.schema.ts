import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { SupportLocale } from 'src/shared/constants'

export type SupportBotUserDocument = HydratedDocument<SupportBotUser>

/**
 * Everyone who has ever interacted with the bot, whether or not they ever asked
 * a question.
 *
 * Deliberately not the same row as {@link SupportTopic}: pressing *Balance* or
 * changing language must not open a support thread, and a schema that stored
 * the preference on the topic would have to invent one to remember it. Nor
 * `tma_users`, which only exists for people who have opened the Mini App —
 * anyone can message a bot.
 */
@Schema({ timestamps: true, collection: 'support_bot_users', versionKey: false })
export class SupportBotUser {
  @Prop({ type: Number, unique: true, required: true, index: true })
  telegramId: number

  /**
   * Profile snapshot, refreshed on every inbound update.
   *
   * Stored because there is no Bot API call that looks a user up by id: without
   * the snapshot, an admin reading an old thread would have nothing but a
   * number, and a topic title could never be corrected after a rename.
   */
  @Prop({ type: String, default: '' })
  firstName: string

  @Prop({ type: String, default: '' })
  lastName: string

  @Prop({ type: String, default: '' })
  username: string

  /** Telegram's IETF tag as last seen — `uk`, `ru`, `en-GB`. The client's guess. */
  @Prop({ type: String, default: '' })
  languageCode: string

  /**
   * The language this user picked by hand, which outranks {@link languageCode}.
   *
   * `null` means "follow the client", and that is the difference the field
   * exists for: a Ukrainian living abroad has an English phone, and Telegram
   * will keep saying so on every single message. Without somewhere to record
   * the correction, the bot would forget it the moment they sent the next one.
   */
  @Prop({ type: String, enum: SupportLocale, default: null })
  preferredLocale: SupportLocale | null

  @Prop({ type: Date, default: null })
  lastSeenAt: Date | null

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const SupportBotUserSchema = SchemaFactory.createForClass(SupportBotUser)
