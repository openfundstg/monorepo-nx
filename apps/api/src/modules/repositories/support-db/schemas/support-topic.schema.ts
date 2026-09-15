import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { SupportTopicStatus, SupportTopicTitleState } from 'src/shared/constants'

export type SupportTopicDocument = HydratedDocument<SupportTopic>

/**
 * The mapping between one Telegram user and the forum topic that carries their
 * support conversation.
 *
 * Deliberately its own collection rather than fields on `tma_users`: anyone can
 * message the bot, including somebody who has never opened the Mini App, and a
 * support conversation must not depend on a user record existing. The two are
 * joined by `telegramId` when a joined view is wanted, never by a foreign key.
 */
@Schema({ timestamps: true, collection: 'support_topics', versionKey: false })
export class SupportTopic {
  /** The user's private chat with the bot. Also their Telegram user id. */
  @Prop({ type: Number, unique: true, required: true, index: true })
  telegramId: number

  /**
   * The topic's id inside the support supergroup — Telegram's
   * `message_thread_id`, which is also the `message_id` of the service message
   * that opened the topic.
   *
   * Unique because a thread belongs to exactly one user: the admin-side lookup
   * is `thread → user`, and two rows claiming one thread would make that lookup
   * pick a recipient at random. It is rewritten, not added to, when a topic is
   * deleted in the group and has to be recreated.
   */
  @Prop({ type: Number, unique: true, required: true, index: true })
  messageThreadId: number

  @Prop({ type: String, enum: SupportTopicStatus, default: SupportTopicStatus.OPEN })
  status: SupportTopicStatus

  /**
   * The user's name as the title spells it, without the state marker.
   *
   * Kept apart from {@link titleState} so the two halves of a title can change
   * independently: a user renaming themselves and a conversation changing hands
   * are different events, and each must be able to rewrite its own half without
   * the other's value having to be looked up first.
   */
  @Prop({ type: String, default: '' })
  displayName: string

  /**
   * What the title currently says — the marker Telegram is showing right now,
   * not what it ought to show.
   *
   * That distinction is the point: every rename posts a service line into the
   * thread, so the title is only rewritten when this field disagrees with the
   * new state. Without it, every single message would rename the topic and the
   * conversation would be half service notices.
   */
  @Prop({ type: String, enum: SupportTopicTitleState, default: SupportTopicTitleState.OPEN })
  titleState: SupportTopicTitleState

  /**
   * The exact title last written to Telegram.
   *
   * Compared against rather than recomputed from {@link displayName}, because
   * the *format* of a title can change too: when the state marker moved out of
   * the name and into the topic's icon, every existing topic was left showing a
   * title this code would no longer produce. An empty value here means "never
   * written by the current format", which is what makes the next message fix it.
   */
  @Prop({ type: String, default: '' })
  titleWritten: string

  @Prop({ type: Date, default: null })
  lastUserMessageAt: Date | null

  @Prop({ type: Date, default: null })
  lastAdminMessageAt: Date | null

  @Prop({ type: Date, default: null })
  closedAt: Date | null

  /**
   * Written by `timestamps: true`, declared here so it is visible on the lean
   * type. The admin panel sorts and filters on it, and a field Mongo writes but
   * TypeScript does not know about is one an aggregation can use and a mapper
   * cannot.
   */
  createdAt: Date

  updatedAt: Date
}

export const SupportTopicSchema = SchemaFactory.createForClass(SupportTopic)
