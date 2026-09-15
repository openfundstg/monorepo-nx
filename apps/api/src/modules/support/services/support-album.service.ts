import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { SUPPORT_ALBUM_QUEUE, type SupportAlbumJobData } from 'src/shared/constants'
import { REDIS_CLIENT, RedisKeys } from 'src/shared/redis'
import type { TelegramMessage } from 'src/shared/interfaces'
import { SupportConfig } from 'src/modules/support/constants/support.constants'

/** A gathered album, and the keys holding it until it is safely delivered. */
export interface SupportAlbum {
  readonly chatId: number
  readonly mediaGroupId: string
  readonly items: readonly TelegramMessage[]
}

/**
 * Puts an album back together.
 *
 * Telegram delivers a media group as **one update per item** — same
 * `media_group_id`, no count, no "that was the last one". So the end of an
 * album can only be inferred from a gap.
 *
 * **The gap cannot be waited for inside the webhook request.** Telegram sends a
 * chat's updates one at a time and holds the next until the current one is
 * answered, so a request sleeping until the rest of the album arrives is
 * blocking the very updates it waits for: the first item gives up alone, then
 * the second, then the third, and three photos land as three messages. That is
 * exactly what the first version of this did.
 *
 * So each item is buffered and acknowledged at once, and a job scheduled
 * {@link SupportConfig.ALBUM_WINDOW_MS} later does the sending. The job is
 * re-scheduled by every item that follows, which turns the delay into "two
 * seconds after the *last* item" rather than after the first.
 */
@Injectable()
export class SupportAlbumService {
  private readonly logger = new Logger(SupportAlbumService.name)

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(SUPPORT_ALBUM_QUEUE) private readonly albumQueue: Queue<SupportAlbumJobData>
  ) {}

  /** Buffers one item and (re)arms the flush that will send the whole group. */
  async collect(message: TelegramMessage): Promise<void> {
    const mediaGroupId = message.media_group_id
    if (!mediaGroupId) return

    const chatId = message.chat.id
    const itemsKey = RedisKeys.Support.albumItems(chatId, mediaGroupId)

    await this.redis.rpush(itemsKey, JSON.stringify(message))
    await this.redis.expire(itemsKey, SupportConfig.ALBUM_BUFFER_TTL_S)
    await this.scheduleFlush(chatId, mediaGroupId)
  }

  /**
   * The album as it now stands, oldest first.
   *
   * The buffer is deliberately **not** cleared here — {@link settle} does that,
   * once the album is actually delivered. A send that fails therefore leaves
   * the items in place for the job's retry to find. The cost is a duplicated
   * album if we die between sending and settling; the alternative cost is an
   * album delivered with two of its three photos missing, and duplication is
   * the kinder failure in a support chat.
   */
  async take(chatId: number, mediaGroupId: string): Promise<SupportAlbum> {
    const raw = await this.redis.lrange(RedisKeys.Support.albumItems(chatId, mediaGroupId), 0, -1)

    const byMessageId = new Map<number, TelegramMessage>()

    // Deduplicated on the way out, because the same item can be buffered twice:
    // a webhook that fails after the item was pushed is redelivered by Telegram
    // and pushed again. Without this the album goes out with a photo repeated.
    for (const entry of raw) {
      const message = JSON.parse(entry) as TelegramMessage
      if (!byMessageId.has(message.message_id)) byMessageId.set(message.message_id, message)
    }

    // Telegram numbers messages in the order it accepted them, which is the
    // order the user arranged the album in. Arrival order need not match it,
    // and a shuffled album is an operator reading "after" before "before".
    const items = [...byMessageId.values()].sort((a, b) => a.message_id - b.message_id)

    return { chatId, mediaGroupId, items }
  }

  /** Drops a delivered album's buffer. Called only after it is through. */
  async settle(album: SupportAlbum): Promise<void> {
    await this.redis.del(RedisKeys.Support.albumItems(album.chatId, album.mediaGroupId))
  }

  /**
   * Arms the flush, replacing any flush already armed for this album.
   *
   * A fixed job id is what makes that possible: BullMQ refuses a second job
   * under a live id, so the pending one is removed first and the delay starts
   * again from this item. Removal races harmlessly — the worst case is two
   * flushes, and the second finds an empty buffer.
   */
  private async scheduleFlush(chatId: number, mediaGroupId: string): Promise<void> {
    // Underscore, never a colon: BullMQ reserves `:` as its Redis key separator
    // and rejects a custom id containing one — which it does by throwing inside
    // `add`, so the webhook 500s and Telegram redelivers the item forever.
    const jobId = `${chatId}_${mediaGroupId}`

    try {
      await this.albumQueue.remove(jobId)
    } catch {
      // Nothing armed yet, or it is already running. Either way the add below
      // is what matters, and a failure to remove must not lose the item.
    }

    await this.albumQueue.add(
      'flush',
      { chatId, mediaGroupId },
      {
        jobId,
        delay: SupportConfig.ALBUM_WINDOW_MS,
        attempts: SupportConfig.ALBUM_FLUSH_ATTEMPTS,
        backoff: { type: 'exponential', delay: SupportConfig.ALBUM_FLUSH_BACKOFF_MS },
        removeOnComplete: true,
        // Kept on failure so a lost album can be seen rather than only inferred;
        // the buffer behind it expires on its own.
        removeOnFail: 50
      }
    )

    this.logger.debug(`Album ${mediaGroupId} in chat ${chatId}: flush armed`)
  }
}
