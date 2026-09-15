import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import Redis from 'ioredis'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import { SupportTopicStatus, SupportTopicTitleState } from 'src/shared/constants'
import { TelegramFailure, describeTelegramFailure, telegramFailureOf } from 'src/shared/utils'
import { TelegramParseMode } from 'src/shared/interfaces'
import type { TelegramUser } from 'src/shared/interfaces'
import {
  SupportTopicDbService,
  type StoredSupportTopic
} from 'src/modules/repositories/support-db/services'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import { SupportAdminText } from 'src/modules/support/constants/support-bot-text.constants'
import { TelegramBotApiService } from 'src/modules/support/services/telegram-bot.api.service'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import {
  buildTopicName,
  displayNameOf,
  escapeTelegramHtml,
  topicIconOf
} from 'src/modules/support/utils'

/** A user's thread, and whether this call is what brought it into being. */
export interface ResolvedTopic {
  readonly threadId: number
  readonly created: boolean
}

/** Attempts to read a topic another request is creating, and the gap between them. */
const CONTENDED_READ_ATTEMPTS = 5
const CONTENDED_READ_DELAY_MS = 300

@Injectable()
export class SupportTopicService {
  private readonly logger = new Logger(SupportTopicService.name)

  constructor(
    private readonly topicDbService: SupportTopicDbService,
    private readonly telegramApi: TelegramBotApiService,
    private readonly config: SupportConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * The thread a user's message belongs in — creating or reopening it as needed.
   *
   * The three states are deliberately not collapsed into one upsert: creating a
   * topic is an external side effect that cannot be rolled back, so it happens
   * only on the branch that has established there is nothing to reuse.
   */
  async ensureOpenTopic(user: TelegramUser): Promise<ResolvedTopic> {
    const existing = await this.topicDbService.findByTelegramId(user.id)

    if (!existing) return this.createTopic(user)

    if (existing.status === SupportTopicStatus.CLOSED) {
      return { threadId: await this.reopen(user, existing), created: false }
    }

    await this.applyTitle(existing, { displayName: displayNameOf(user) })

    return { threadId: existing.messageThreadId, created: false }
  }

  /**
   * Replaces a thread that no longer exists in Telegram.
   *
   * A topic deleted by hand in the group leaves a mapping row pointing at
   * nothing, and every subsequent message from that user would fail with the
   * same 400 forever. The conversation's history in our own collection is kept;
   * only Telegram's side of it is rebuilt.
   */
  async recreateTopic(user: TelegramUser): Promise<number> {
    const displayName = displayNameOf(user)
    const topic = await this.openForumTopic(displayName)

    await this.topicDbService.replaceThread(user.id, topic.message_thread_id, displayName)
    await this.postIntro(topic.message_thread_id, user)

    this.logger.log(`Recreated support topic ${topic.message_thread_id} for user ${user.id}`)

    return topic.message_thread_id
  }

  /**
   * Clears one of Telegram's own service lines out of the group.
   *
   * Renaming a topic makes Telegram write "X changed the topic title to …" into
   * the thread, and a support conversation is not improved by a running
   * commentary on its own title. Deleting it is the only way to hide it —
   * Telegram has no setting for these, and the only topic it can hide at all is
   * General.
   *
   * Best effort on purpose. The bot may not hold `can_delete_messages`, in
   * which case the line stays and nothing else is affected; a failed cleanup
   * must never cost the message that triggered it.
   */
  async dropServiceNotice(messageId: number): Promise<void> {
    try {
      await this.telegramApi.deleteMessage({
        chat_id: this.config.requireGroupId(),
        message_id: messageId
      })
    } catch (error) {
      this.logger.debug(
        `Could not remove service notice ${messageId}: ` +
          describeTelegramFailure('deleteMessage', error)
      )
    }
  }

  /**
   * Reopens a thread Telegram says is closed, when our own records disagree.
   *
   * An admin closing a topic from the Telegram UI rather than with `/close`
   * sends us a service message this module deliberately ignores, so the stored
   * status stays `OPEN` while Telegram's is not. Without this the owner's next
   * message fails with `TOPIC_CLOSED` on every retry, forever — the one bug in
   * this module that would have been invisible until a customer complained
   * twice.
   */
  async reopenThread(messageThreadId: number): Promise<void> {
    await this.telegramApi.reopenForumTopic({
      chat_id: this.config.requireGroupId(),
      message_thread_id: messageThreadId
    })
    await this.topicDbService.markOpenByThreadId(messageThreadId)

    this.logger.log(`Reopened topic ${messageThreadId}, which was closed outside /close`)
  }

  /**
   * Hides a topic on an admin's `/close`.
   *
   * The mapping row stays and only its status changes — the same user writing
   * tomorrow reopens this thread rather than starting a fresh one, which is the
   * entire point of closing rather than deleting.
   */
  async closeTopic(messageThreadId: number): Promise<void> {
    try {
      await this.telegramApi.closeForumTopic({
        chat_id: this.config.requireGroupId(),
        message_thread_id: messageThreadId
      })
    } catch (error) {
      // Already gone in Telegram: the local row still has to be marked, or the
      // next message from its owner would try to reopen a thread that is not
      // there instead of recreating it.
      if (telegramFailureOf(error) !== TelegramFailure.THREAD_NOT_FOUND) throw error

      this.logger.warn(`Topic ${messageThreadId} no longer exists in Telegram; marking it closed`)
    }

    await this.topicDbService.markClosed(messageThreadId)

    const topic = await this.topicDbService.findByThreadId(messageThreadId)
    if (topic) await this.applyTitle(topic, { state: SupportTopicTitleState.CLOSED })
  }

  /**
   * Creates a user's first topic, serialised on a Redis lock.
   *
   * Two messages sent in the same second by someone with no topic yet would
   * otherwise create two threads, and the mapping row would name only whichever
   * insert landed second. The loser of the race waits for the winner's row
   * rather than creating anything: `createForumTopic` has no idempotency key,
   * so the only way not to make a second topic is not to call it.
   */
  private async createTopic(user: TelegramUser): Promise<ResolvedTopic> {
    const lockKey = RedisKeys.Support.topicLock(user.id)
    const acquired = await this.redis.set(lockKey, '1', 'PX', SupportConfig.TOPIC_LOCK_TTL_MS, 'NX')

    // `created` is false on this path even though a topic did come into being:
    // the request that made it has already greeted the user, and the flag is
    // what decides whether they are greeted again.
    if (!acquired) return { threadId: await this.awaitContendedTopic(user.id), created: false }

    try {
      // Re-read under the lock. The row may have appeared between the caller's
      // check and this one, in which case there is nothing to create.
      const existing = await this.topicDbService.findByTelegramId(user.id)
      if (existing) return { threadId: existing.messageThreadId, created: false }

      const displayName = displayNameOf(user)
      const topic = await this.openForumTopic(displayName)

      await this.topicDbService.createTopic(user.id, topic.message_thread_id, displayName)
      await this.postIntro(topic.message_thread_id, user)

      this.logger.log(`Opened support topic ${topic.message_thread_id} for user ${user.id}`)

      return { threadId: topic.message_thread_id, created: true }
    } finally {
      await this.redis.del(lockKey)
    }
  }

  /**
   * Opens a thread in the support group.
   *
   * The one failure singled out here is a group with Topics switched off. It is
   * permanent — every message from every user fails the same way until somebody
   * turns them on — and Telegram reports it as a bare `400`, which reaches the
   * logs as "Request failed with status code 400" and tells an operator
   * nothing. Saying what is wrong and where is the whole point of the branch;
   * the error is still rethrown, so Telegram keeps the delivery and the backlog
   * arrives the moment Topics are enabled.
   */
  private async openForumTopic(displayName: string) {
    const chatId = this.config.requireGroupId()
    const name = buildTopicName(displayName)

    try {
      return await this.telegramApi.createForumTopic({
        chat_id: chatId,
        name,
        icon_custom_emoji_id: topicIconOf(SupportTopicTitleState.OPEN)
      })
    } catch (error) {
      const failure = telegramFailureOf(error)

      if (failure === TelegramFailure.NOT_A_FORUM) {
        this.logger.error(
          `Support group ${this.config.groupId} has Topics switched off, so no conversation can ` +
            'be opened. Enable "Topics" in the group settings; the messages Telegram is holding ' +
            'will be delivered once you do.'
        )
        throw error
      }

      // The icon is decoration and the message is not. Telegram's topic-icon
      // ids are a fixed system set and have been stable for years, but a
      // rejected one would otherwise stop every conversation from opening — so
      // it is retried once without it and the topic keeps the default colour.
      this.logger.warn(
        `Could not open a topic with its icon (${describeTelegramFailure('createForumTopic', error)}); ` +
          'retrying plain'
      )

      return this.telegramApi.createForumTopic({
        chat_id: chatId,
        name,
        icon_color: SupportConfig.TOPIC_ICON_COLOR
      })
    }
  }

  /**
   * Waits out the request that is creating this user's topic.
   *
   * Ends in a 503 rather than a fabricated thread id, which hands the decision
   * back to Telegram: a failed webhook delivery is retried, so the message
   * arrives a moment later instead of being lost or duplicated.
   */
  private async awaitContendedTopic(telegramId: number): Promise<number> {
    for (let attempt = 0; attempt < CONTENDED_READ_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, CONTENDED_READ_DELAY_MS))

      const topic = await this.topicDbService.findByTelegramId(telegramId)
      if (topic) return topic.messageThreadId
    }

    this.logger.warn(`Topic creation for ${telegramId} is still in flight; deferring to a retry`)
    throw new ServiceUnavailableException(ERROR.SUPPORT.RELAY_FAILED)
  }

  /** Brings a closed topic back, or rebuilds it if Telegram no longer has it. */
  private async reopen(user: TelegramUser, topic: StoredSupportTopic): Promise<number> {
    try {
      await this.telegramApi.reopenForumTopic({
        chat_id: this.config.requireGroupId(),
        message_thread_id: topic.messageThreadId
      })
    } catch (error) {
      if (telegramFailureOf(error) !== TelegramFailure.THREAD_NOT_FOUND) throw error

      return this.recreateTopic(user)
    }

    await this.topicDbService.markOpen(user.id)
    await this.applyTitle(topic, {
      displayName: displayNameOf(user),
      state: SupportTopicTitleState.OPEN
    })
    this.logger.log(`Reopened support topic ${topic.messageThreadId} for user ${user.id}`)

    return topic.messageThreadId
  }

  /**
   * Moves a conversation into a state, renaming the topic if that changes what
   * its title says.
   *
   * Called on both directions of every relayed message, which is why the
   * comparison below is not an optimisation: a rename posts a service line into
   * the thread, so renaming unconditionally would leave every conversation half
   * notices. The stored title is what Telegram is showing, so comparing against
   * it renames exactly on a change and never otherwise.
   */
  async applyState(telegramId: number, state: SupportTopicTitleState): Promise<void> {
    const topic = await this.topicDbService.findByTelegramId(telegramId)
    if (!topic) return

    await this.applyTitle(topic, { state })
  }

  /**
   * Writes a title, if either half of it moved — best effort, by design.
   *
   * A failed rename must not stop the message that triggered it: the title is a
   * convenience for operators, the message is the product. `editForumTopic`
   * also needs `can_manage_topics`, which the bot may lose without anything
   * else breaking, and that must not turn into a support outage.
   */
  private async applyTitle(
    topic: StoredSupportTopic,
    change: { displayName?: string; state?: SupportTopicTitleState }
  ): Promise<void> {
    const displayName = change.displayName ?? topic.displayName
    const state = change.state ?? topic.titleState
    const name = buildTopicName(displayName)

    // Compared against the title actually written, not against `displayName`:
    // a topic titled in the old format — the state as an emoji in front of the
    // name — must be rewritten even though neither half has "changed".
    if (name === topic.titleWritten && state === topic.titleState) return

    try {
      await this.telegramApi.editForumTopic({
        chat_id: this.config.requireGroupId(),
        message_thread_id: topic.messageThreadId,
        name,
        icon_custom_emoji_id: topicIconOf(state)
      })
      await this.topicDbService.setTitle(topic.telegramId, displayName, state)
    } catch (error) {
      this.logger.warn(
        `Could not rename topic ${topic.messageThreadId}: ` +
          describeTelegramFailure('editForumTopic', error)
      )
    }
  }

  /** The card admins read before the user's first message. */
  private async postIntro(messageThreadId: number, user: TelegramUser): Promise<void> {
    await this.telegramApi.sendMessage({
      chat_id: this.config.requireGroupId(),
      message_thread_id: messageThreadId,
      text: SupportAdminText.topicIntro(
        escapeTelegramHtml(displayNameOf(user)),
        escapeTelegramHtml(user.username ? `@${user.username}` : ''),
        user.id
      ),
      parse_mode: TelegramParseMode.HTML
    })
  }
}
