import { Inject, Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import type { TelegramUpdate } from 'src/shared/interfaces'
import { SupportCommand, SupportUpdateKind } from 'src/modules/support/enums'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { SupportMenuService } from 'src/modules/support/services/support-menu.service'
import { SupportRelayService } from 'src/modules/support/services/support-relay.service'
import { SupportTopicService } from 'src/modules/support/services/support-topic.service'
import { SupportUserService } from 'src/modules/support/services/support-user.service'
import { SupportFiatWatchService } from 'src/modules/support/services/support-fiat-watch.service'
import { SupportCardSaleService } from 'src/modules/support/services/support-card-sale.service'
import {
  buttonOf,
  classifyUpdate,
  commandOf,
  isCardSaleCallback,
  isFiatWatchOffCallback,
  type ClassifiedUpdate
} from 'src/modules/support/utils'

/**
 * The entry point for everything Telegram delivers: deduplicate, classify,
 * delegate.
 *
 * Processing is inline rather than queued, and the failure contract follows
 * from that. Telegram retries a webhook delivery it did not get a 2xx for, so
 * an exception escaping this method is not a lost message — it is a redelivery.
 * That is only true while the deduplication key is released on failure, which
 * is why the `catch` below deletes it before rethrowing.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name)

  constructor(
    private readonly config: SupportConfigService,
    private readonly relayService: SupportRelayService,
    private readonly topicService: SupportTopicService,
    private readonly menuService: SupportMenuService,
    private readonly userService: SupportUserService,
    private readonly fiatWatchService: SupportFiatWatchService,
    private readonly cardSaleService: SupportCardSaleService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * Handles one update, at most once.
   *
   * The key is taken with `NX` *before* any work, so a redelivery that arrives
   * while the first attempt is still running is dropped rather than racing it —
   * two concurrent attempts at a user's first message is exactly how a person
   * ends up with two topics. On success it is extended to cover Telegram's full
   * retry window; on failure it is released so the retry is allowed through.
   */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.config.isEnabled) {
      this.logger.debug(`Support is not configured; dropping update ${update.update_id}`)

      return
    }

    const key = RedisKeys.Support.update(update.update_id)
    const acquired = await this.redis.set(key, '1', 'PX', SupportConfig.UPDATE_LOCK_TTL_MS, 'NX')

    if (!acquired) {
      this.logger.debug(`Update ${update.update_id} is a duplicate or already in flight`)

      return
    }

    try {
      await this.dispatch(classifyUpdate(update, this.config.requireGroupId()))
      await this.redis.set(key, '1', 'EX', SupportConfig.UPDATE_PROCESSED_TTL_S)
    } catch (error) {
      await this.redis.del(key)
      throw error
    }
  }

  private async dispatch(classified: ClassifiedUpdate): Promise<void> {
    // Telegram's own commentary on a topic being renamed, closed or reopened.
    // Nobody needs to read it, so it is swept up rather than ignored.
    if (classified.kind === SupportUpdateKind.SERVICE_NOTICE)
      return this.topicService.dropServiceNotice(classified.messageId)

    if (classified.kind === SupportUpdateKind.CALLBACK_QUERY) {
      await this.userService.remember(classified.from)

      // Routed by payload prefix, because there is now more than one kind of
      // inline key: everything used to reach the language handler, which read
      // an unrecognised payload as "no language" and answered nothing. A second
      // feature added without this branch would have inherited that silence.
      if (isFiatWatchOffCallback(classified.query.data))
        return this.fiatWatchService.handleUnsubscribe(classified.query)

      if (isCardSaleCallback(classified.query.data))
        return this.cardSaleService.handleAnswer(classified.query)

      return this.menuService.handleLanguageChoice(classified.query)
    }

    if (classified.kind === SupportUpdateKind.USER_MESSAGE) {
      const { message, from } = classified
      // Recorded before anything is decided, because the language the answer is
      // written in is a property of the person and every branch below needs it.
      const locale = await this.userService.remember(from)

      // `/start` is the button Telegram shows before a chat has any history. It
      // must not open a support conversation: the same bot hosts the Mini App,
      // so a good share of the people pressing it are not asking anything.
      if (commandOf(message) === SupportCommand.START)
        return this.menuService.sendGreeting(from, locale)

      // A keyboard press arrives as plain text carrying the key's label, so
      // this check has to come before the relay — otherwise every tap on
      // *Balance* reaches an operator as a one-word question.
      const button = buttonOf(message.text)
      if (button) return this.menuService.handleButton(button, from, locale)

      return this.relayService.relayToGroup(message, from, locale)
    }

    if (classified.kind === SupportUpdateKind.ADMIN_MESSAGE) {
      const { message, threadId } = classified

      if (commandOf(message) === SupportCommand.CLOSE) {
        await this.topicService.closeTopic(threadId)

        return this.relayService.confirmClose(threadId)
      }

      return this.relayService.relayToUser(message, threadId)
    }
  }
}
