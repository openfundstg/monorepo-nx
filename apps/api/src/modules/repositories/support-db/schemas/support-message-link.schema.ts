import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type SupportMessageLinkDocument = HydratedDocument<SupportMessageLink>

/** How long a link survives, in seconds. Ninety days. */
const LINK_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * One message, as it exists on both sides of the relay.
 *
 * A message copied from a private chat into a topic gets a **new id** in that
 * topic, and vice versa. So when somebody replies, the `message_id` Telegram
 * hands us is meaningful only in the chat the reply came from — quoting that
 * number in the other chat would quote whatever unrelated message happens to
 * sit at it. This collection is the translation between the two, and without it
 * a reply can be relayed but not shown *as* a reply.
 *
 * Only relayed messages are recorded. The bot's own lines — a greeting, a
 * balance card, the intro posted into a new topic — exist on one side only, so
 * a reply to one of those simply arrives without a quote.
 */
@Schema({ timestamps: true, collection: 'support_message_links', versionKey: false })
export class SupportMessageLink {
  @Prop({ type: Number, required: true, index: true })
  telegramId: number

  @Prop({ type: Number, required: true })
  messageThreadId: number

  /** The message's id in the user's private chat with the bot. */
  @Prop({ type: Number, required: true })
  userMessageId: number

  /** The same message's id inside the support group. */
  @Prop({ type: Number, required: true })
  groupMessageId: number

  /**
   * When this pair was recorded. Carries the TTL index below.
   *
   * Written explicitly rather than leaning on `createdAt`, because a TTL index
   * is a property of one named field and hanging it off a timestamp Mongoose
   * manages would tie expiry to a convention rather than to a decision.
   */
  @Prop({ type: Date, default: Date.now })
  linkedAt: Date
}

export const SupportMessageLinkSchema = SchemaFactory.createForClass(SupportMessageLink)

/**
 * The two lookups, one index each — a reply is resolved on the hot path of
 * every relayed message, so neither may be a collection scan.
 *
 * Unique in both directions: a message has exactly one counterpart, and a
 * duplicate would mean the relay copied the same message twice.
 */
SupportMessageLinkSchema.index({ telegramId: 1, userMessageId: 1 }, { unique: true })
SupportMessageLinkSchema.index({ groupMessageId: 1 }, { unique: true })

/**
 * Links expire after ninety days.
 *
 * The collection grows with every message relayed and nothing else ever deletes
 * from it. Ninety days is long past the point where anyone replies to a support
 * message; when a link has gone, the reply is still delivered — just without
 * the quote, because `allow_sending_without_reply` is set on every send.
 */
SupportMessageLinkSchema.index({ linkedAt: 1 }, { expireAfterSeconds: LINK_TTL_SECONDS })
