import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { SUPPORT_ALBUM_QUEUE, type SupportAlbumJobData } from 'src/shared/constants'
import { TelegramChatType } from 'src/shared/interfaces'
import { SupportAlbumService } from 'src/modules/support/services/support-album.service'
import { SupportConfigService } from 'src/modules/support/services/support-config.service'
import { SupportRelayService } from 'src/modules/support/services/support-relay.service'
import { SupportUserService } from 'src/modules/support/services/support-user.service'

/**
 * Sends an album once Telegram has stopped adding to it.
 *
 * The work is here rather than in the webhook request for one reason, and it is
 * worth keeping written down: Telegram delivers a chat's updates **one at a
 * time**, holding the next until the current is answered. A request that waited
 * for the rest of an album would be blocking the very items it waited for.
 *
 * Which side the album is going to is not carried in the job — it is read off
 * the messages themselves. The buffer holds whole updates, so the first item
 * says whether this came from a private chat or from a topic, and everything
 * else follows from that.
 */
@Processor(SUPPORT_ALBUM_QUEUE)
export class SupportAlbumWorker extends WorkerHost {
  private readonly logger = new Logger(SupportAlbumWorker.name)

  constructor(
    private readonly albumService: SupportAlbumService,
    private readonly relayService: SupportRelayService,
    private readonly userService: SupportUserService,
    private readonly config: SupportConfigService
  ) {
    super()
  }

  async process(job: Job<SupportAlbumJobData>): Promise<void> {
    const { chatId, mediaGroupId } = job.data
    const album = await this.albumService.take(chatId, mediaGroupId)

    // Empty means a previous run already delivered and settled it — two flushes
    // can be armed if an item lands while one is starting.
    if (album.items.length === 0) return

    const first = album.items[0]

    if (first.chat.type === TelegramChatType.PRIVATE && first.from) {
      const locale = await this.userService.remember(first.from)

      return this.relayService.relayAlbumToGroup(album, first.from, locale)
    }

    const threadId = first.message_thread_id

    if (chatId === this.config.groupId && threadId) {
      return this.relayService.relayAlbumToUser(album, threadId)
    }

    // Neither side of the relay. Nothing can be done with it, and leaving the
    // buffer would have it retried forever.
    this.logger.warn(`Album ${mediaGroupId} in chat ${chatId} belongs to neither side; dropping`)
    await this.albumService.settle(album)
  }
}
