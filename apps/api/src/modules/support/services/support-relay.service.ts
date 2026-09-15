import { Injectable, Logger } from '@nestjs/common'
import { TelegramParseMode } from 'src/shared/interfaces'
import type {
  TelegramInputMedia,
  TelegramMessage,
  TelegramReplyParameters,
  TelegramUser
} from 'src/shared/interfaces'
import { TelegramFailure, describeTelegramFailure, telegramFailureOf } from 'src/shared/utils'
import { SupportLocale, SupportTopicTitleState } from 'src/shared/constants'
import {
  SupportMessageLinkDbService,
  SupportTopicDbService
} from 'src/modules/repositories/support-db/services'
import {
  SupportAdminText,
  SupportUserText
} from 'src/modules/support/constants/support-bot-text.constants'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { SupportAlbumService, type SupportAlbum } from 'src/modules/support/services/support-album.service'
import { SupportMenuService } from 'src/modules/support/services/support-menu.service'
import { SupportTopicService } from 'src/modules/support/services/support-topic.service'
import {
  albumReplyParameters,
  albumReplyTarget,
  buildAlbumMedia
} from 'src/modules/support/utils'

/**
 * A quote that never costs a delivery.
 *
 * `allow_sending_without_reply` is what keeps a reply to a deleted message from
 * failing the whole send — the quote is a nicety, the message is not.
 */
/**
 * The same message, stripped of its album membership.
 *
 * Used only on the fallback path, where an album could not be rebuilt and its
 * items go one at a time: without this the recursive call would try to gather
 * the album all over again.
 */
const withoutAlbum = (message: TelegramMessage): TelegramMessage => ({
  ...message,
  media_group_id: undefined
})

const quoting = (messageId: number): TelegramReplyParameters => ({
  message_id: messageId,
  allow_sending_without_reply: true
})

/**
 * Carries messages between a user's private chat and their topic in the
 * support group. Everything about *which* message goes where lives here;
 * everything about the topic itself lives in {@link SupportTopicService}.
 *
 * **Both directions copy; neither forwards.** Out of the group a forward is
 * impossible anyway — it would stamp the message "Forwarded from …" with the
 * title of a private group the user must never learn exists, and the whole
 * illusion that the bot is a person rests on that. Into the group a forward was
 * the obvious choice, since it shows the real sender; it lost to one fact:
 * **Telegram does not let a forward be a reply.** `forwardMessage` takes no
 * `reply_parameters`, so a forwarded message cannot carry the reply the user
 * actually wrote — and a thread where nobody can tell what a bare "так, дякую"
 * answers is worth less than a "Forwarded from" header. The sender is named by
 * the topic itself: its title is their name and its first message their profile
 * card.
 *
 * Neither direction inspects the message. Media, stickers, documents, albums
 * and message types that did not exist when this was written all travel by id.
 */
@Injectable()
export class SupportRelayService {
  private readonly logger = new Logger(SupportRelayService.name)

  constructor(
    private readonly topicService: SupportTopicService,
    private readonly topicDbService: SupportTopicDbService,
    private readonly linkDbService: SupportMessageLinkDbService,
    private readonly albumService: SupportAlbumService,
    private readonly menuService: SupportMenuService,
    private readonly telegramApi: TelegramBotApiService,
    private readonly config: SupportConfigService
  ) {}

  /** A user wrote to the bot. */
  async relayToGroup(
    message: TelegramMessage,
    user: TelegramUser,
    locale: SupportLocale
  ): Promise<void> {
    // An album arrives as one update per item. Every item but the last returns
    // here and does nothing; the last one carries the whole group.
    // An album arrives as one update per item, and the group is only complete
    // once Telegram stops sending. Buffer and acknowledge; the flush job sends.
    if (message.media_group_id) return this.albumService.collect(message)

    const { threadId, created } = await this.topicService.ensureOpenTopic(user)
    const delivered = await this.copyToTopic(message, user, threadId)

    // Both halves of the pair are known only now: the copy's id in the group
    // comes back from the call that made it.
    await this.linkDbService.link(
      user.id,
      delivered.threadId,
      message.message_id,
      delivered.groupMessageId
    )

    // The acknowledgement inside goes out only on the very first message: one
    // on every message would be a second notification per question asked.
    await this.afterUserMessage(user, delivered.threadId, created, locale)
  }

  /** An admin wrote inside a topic. */
  async relayToUser(message: TelegramMessage, threadId: number): Promise<void> {
    if (message.media_group_id) return this.albumService.collect(message)

    const topic = await this.topicDbService.findByThreadId(threadId)

    if (!topic) {
      this.logger.warn(`Message in unmapped topic ${threadId}; nothing to deliver it to`)
      await this.postToTopic(threadId, SupportAdminText.UNLINKED_TOPIC)

      return
    }

    const replyParameters = await this.userReplyTarget(message)

    try {
      const copy = await this.telegramApi.copyMessage({
        chat_id: topic.telegramId,
        from_chat_id: this.config.requireGroupId(),
        message_id: message.message_id,
        reply_parameters: replyParameters
      })

      await Promise.all([
        this.topicDbService.touchAdminMessage(threadId),
        this.linkDbService.link(topic.telegramId, threadId, copy.message_id, message.message_id)
      ])
    } catch (error) {
      const notice = this.deliveryFailureNotice(error)
      // An undeliverable message is not a failed *webhook*: retrying it would
      // never succeed, so the delivery is acknowledged and the admin is told in
      // the thread they are already reading.
      if (!notice) throw error

      this.logger.warn(
        `Could not deliver to ${topic.telegramId}: ${describeTelegramFailure('copyMessage', error)}`
      )
      await this.postToTopic(threadId, notice)
    }
  }

  /**
   * Delivers an operator's album to the user as an album.
   *
   * Sent from the bot rather than copied out of the group, which keeps the
   * anonymity the whole relay rests on: nothing in a `sendMediaGroup` names
   * where the files came from.
   */
  async relayAlbumToUser(album: SupportAlbum, threadId: number): Promise<void> {
    const topic = await this.topicDbService.findByThreadId(threadId)

    if (!topic) {
      await this.albumService.settle(album)
      this.logger.warn(`Album in unmapped topic ${threadId}; nothing to deliver it to`)

      return this.postToTopic(threadId, SupportAdminText.UNLINKED_TOPIC)
    }

    const media = buildAlbumMedia(album.items)

    if (!media) {
      this.logger.warn(
        `Album ${album.mediaGroupId} holds media this relay cannot rebuild; copying item by item`
      )
      for (const item of album.items) await this.relayToUser(withoutAlbum(item), threadId)
      await this.albumService.settle(album)

      return
    }

    const repliedTo = albumReplyTarget(album.items)
    const replyParameters = albumReplyParameters(
      repliedTo === undefined ? null : await this.linkDbService.findUserMessageId(repliedTo)
    )

    try {
      const sent = await this.telegramApi.sendMediaGroup({
        chat_id: topic.telegramId,
        media,
        reply_parameters: replyParameters
      })

      await this.albumService.settle(album)
      await this.linkAlbum(topic.telegramId, threadId, album.items, sent, 'toUser')
      await this.topicDbService.touchAdminMessage(threadId)
    } catch (error) {
      const notice = this.deliveryFailureNotice(error)
      if (!notice) throw error

      await this.albumService.settle(album)
      this.logger.warn(
        `Could not deliver an album to ${topic.telegramId}: ` +
          describeTelegramFailure('sendMediaGroup', error)
      )
      await this.postToTopic(threadId, notice)
    }
  }

  /** Confirms an admin's `/close` in the thread it closed. */
  async confirmClose(threadId: number): Promise<void> {
    await this.postToTopic(threadId, SupportAdminText.CLOSED_ACK)
  }

  /**
   * Delivers a whole album into a topic as one album.
   *
   * `sendMediaGroup` rather than a copy per item, because grouping is the whole
   * point — and unlike `copyMessages`, which also keeps grouping, it can carry
   * a reply and a caption we control. The files are re-sent by `file_id`, so
   * nothing is downloaded or uploaded.
   *
   * An album this backend cannot describe — an unfamiliar media type — falls
   * back to copying its items one by one. The grouping is lost; nothing else is.
   */
  async relayAlbumToGroup(
    album: SupportAlbum,
    user: TelegramUser,
    locale: SupportLocale
  ): Promise<void> {
    const { threadId, created } = await this.topicService.ensureOpenTopic(user)
    const media = buildAlbumMedia(album.items)

    if (!media) {
      this.logger.warn(
        `Album ${album.mediaGroupId} holds media this relay cannot rebuild; copying item by item`
      )
      for (const item of album.items) await this.copyToTopic(item, user, threadId)
      await this.albumService.settle(album)

      return this.afterUserMessage(user, threadId, created, locale)
    }

    const repliedTo = albumReplyTarget(album.items)
    const replyParameters = albumReplyParameters(
      repliedTo === undefined
        ? null
        : await this.linkDbService.findGroupMessageId(user.id, repliedTo)
    )

    const delivered = await this.sendAlbumToTopic(user, threadId, media, replyParameters)

    await this.albumService.settle(album)
    await this.linkAlbum(user.id, delivered.threadId, album.items, delivered.sent, 'toGroup')
    await this.afterUserMessage(user, delivered.threadId, created, locale)
  }

  /**
   * Sends an album into a topic, with the same recovery a single message gets.
   *
   * Without this, a topic deleted in the group would fail the album on every
   * redelivery for as long as Telegram kept retrying — the single-message path
   * has rebuilt the topic and retried since the beginning, and an album is not
   * a lesser message.
   *
   * The retry after a rebuild goes out unquoted: whatever it replied to lived
   * in the thread that no longer exists.
   */
  private async sendAlbumToTopic(
    user: TelegramUser,
    threadId: number,
    media: readonly TelegramInputMedia[],
    replyParameters?: TelegramReplyParameters
  ): Promise<{ threadId: number; sent: TelegramMessage[] }> {
    const send = (target: number, reply?: TelegramReplyParameters) =>
      this.telegramApi.sendMediaGroup({
        chat_id: this.config.requireGroupId(),
        message_thread_id: target,
        media,
        reply_parameters: reply
      })

    try {
      return { threadId, sent: await send(threadId, replyParameters) }
    } catch (error) {
      const failure = telegramFailureOf(error)

      if (failure === TelegramFailure.THREAD_NOT_FOUND) {
        const rebuilt = await this.topicService.recreateTopic(user)

        return { threadId: rebuilt, sent: await send(rebuilt) }
      }

      if (failure === TelegramFailure.TOPIC_CLOSED) {
        await this.topicService.reopenThread(threadId)

        return { threadId, sent: await send(threadId, replyParameters) }
      }

      throw error
    }
  }

  /** The bookkeeping every inbound message ends with, album or not. */
  private async afterUserMessage(
    user: TelegramUser,
    threadId: number,
    created: boolean,
    locale: SupportLocale
  ): Promise<void> {
    await Promise.all([
      this.topicDbService.touchUserMessage(user.id),
      this.topicService.applyState(user.id, SupportTopicTitleState.OPEN)
    ])

    if (created) await this.acknowledge(user, locale)
  }

  /**
   * Records a pair per item, so a reply to any one photo of an album still
   * quotes that photo rather than the album's first.
   *
   * `sendMediaGroup` returns its messages in the order it was given them, which
   * is the order the items were sorted into — that correspondence is the only
   * thing making this zip correct, and it is why the buffer sorts by
   * `message_id` before sending.
   */
  private async linkAlbum(
    telegramId: number,
    threadId: number,
    source: readonly TelegramMessage[],
    sent: readonly TelegramMessage[],
    direction: 'toGroup' | 'toUser'
  ): Promise<void> {
    await Promise.all(
      sent.map((delivered, index) => {
        const original = source[index]
        if (!original) return Promise.resolve()

        return direction === 'toGroup'
          ? this.linkDbService.link(
              telegramId,
              threadId,
              original.message_id,
              delivered.message_id
            )
          : this.linkDbService.link(
              telegramId,
              threadId,
              delivered.message_id,
              original.message_id
            )
      })
    )
  }

  /**
   * Copies one message into a topic, recovering from the two states Telegram
   * can be in that our own records cannot see.
   *
   * Each recovery retries once — once, not in a loop: if the second attempt
   * fails the same way, something is wrong with the group rather than with this
   * thread, and a retry storm against Telegram would make it worse.
   *
   * Returns the thread it actually landed in, which is not always the one it
   * was given: a rebuilt topic has a new id, and the caller has a link to
   * record against it.
   */
  private async copyToTopic(
    message: TelegramMessage,
    user: TelegramUser,
    threadId: number
  ): Promise<{ threadId: number; groupMessageId: number }> {
    const replyParameters = await this.groupReplyTarget(user.id, message)

    try {
      return { threadId, groupMessageId: await this.copyInto(message, threadId, replyParameters) }
    } catch (error) {
      const failure = telegramFailureOf(error)

      if (failure === TelegramFailure.THREAD_NOT_FOUND) {
        const rebuilt = await this.topicService.recreateTopic(user)

        // Deliberately unquoted: whatever this replied to lived in the thread
        // that no longer exists, and `allow_sending_without_reply` would drop
        // the quote anyway — this way the intent is on the page.
        return { threadId: rebuilt, groupMessageId: await this.copyInto(message, rebuilt) }
      }

      // Telegram says the topic is closed while our records say it is open —
      // an admin used the UI's Close button instead of `/close`. Reopening is
      // what the user's message means anyway, so it happens here rather than
      // being reported as a failure.
      if (failure === TelegramFailure.TOPIC_CLOSED) {
        await this.topicService.reopenThread(threadId)

        return {
          threadId,
          groupMessageId: await this.copyInto(message, threadId, replyParameters)
        }
      }

      throw error
    }
  }

  private async copyInto(
    message: TelegramMessage,
    threadId: number,
    replyParameters?: TelegramReplyParameters
  ): Promise<number> {
    const copy = await this.telegramApi.copyMessage({
      chat_id: this.config.requireGroupId(),
      message_thread_id: threadId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
      reply_parameters: replyParameters
    })

    return copy.message_id
  }

  /**
   * Turns "the user replied to *this*" into something quotable in the group.
   *
   * The id Telegram gives is meaningful only in the chat the reply came from,
   * so it is translated through the link table. An id with no link — a reply to
   * the bot's own greeting, or to something older than the links are kept — is
   * not an error: the message goes on without a quote.
   */
  private async groupReplyTarget(
    telegramId: number,
    message: TelegramMessage
  ): Promise<TelegramReplyParameters | undefined> {
    const repliedTo = message.reply_to_message?.message_id
    if (!repliedTo) return undefined

    const groupMessageId = await this.linkDbService.findGroupMessageId(telegramId, repliedTo)

    return groupMessageId === null ? undefined : quoting(groupMessageId)
  }

  /** The same translation, in the other direction. */
  private async userReplyTarget(
    message: TelegramMessage
  ): Promise<TelegramReplyParameters | undefined> {
    const repliedTo = message.reply_to_message?.message_id
    if (!repliedTo) return undefined

    const userMessageId = await this.linkDbService.findUserMessageId(repliedTo)

    return userMessageId === null ? undefined : quoting(userMessageId)
  }

  /**
   * The admin-facing explanation for a delivery that cannot be retried, or
   * `undefined` when the failure is one the caller should rethrow.
   *
   * Only permanent conditions are named. A rate limit or an outage is *not*
   * listed and therefore rethrows, so Telegram redelivers the update and the
   * admin's reply eventually lands rather than being replaced by an apology.
   */
  private deliveryFailureNotice(error: unknown): string | undefined {
    const failure = telegramFailureOf(error)

    if (failure === TelegramFailure.BLOCKED_BY_USER) return SupportAdminText.USER_BLOCKED_BOT
    if (failure === TelegramFailure.USER_DEACTIVATED) return SupportAdminText.USER_DEACTIVATED

    return undefined
  }

  /**
   * Tells the user their first message landed — best effort, by design.
   *
   * The question is already in the group by the time this runs, so failing the
   * delivery over a courtesy line would cost a redelivery and put the *question*
   * in twice to get the acknowledgement in once.
   */
  private async acknowledge(user: TelegramUser, locale: SupportLocale): Promise<void> {
    try {
      await this.menuService.sendText(user, SupportUserText.CONVERSATION_STARTED, locale)
    } catch (error) {
      this.logger.warn(
        `Could not acknowledge ${user.id}: ${describeTelegramFailure('sendMessage', error)}`
      )
    }
  }

  /** A line from the bot into a topic, addressed to whoever is reading it. */
  private async postToTopic(threadId: number, text: string): Promise<void> {
    await this.telegramApi.sendMessage({
      chat_id: this.config.requireGroupId(),
      message_thread_id: threadId,
      text,
      parse_mode: TelegramParseMode.HTML
    })
  }
}
