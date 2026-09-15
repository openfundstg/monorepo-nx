import { SupportAlbumService } from './support-album.service'
import type { TelegramMessage } from 'src/shared/interfaces'

const CHAT_ID = 501_234_567
const GROUP = 'album-1'
const ITEMS_KEY = `support:album:${CHAT_ID}:${GROUP}`

const item = (messageId: number): TelegramMessage =>
  ({
    message_id: messageId,
    date: 1,
    chat: { id: CHAT_ID, type: 'private' },
    media_group_id: GROUP
  }) as TelegramMessage

describe('SupportAlbumService', () => {
  let redis: Record<string, jest.Mock>
  let queue: Record<string, jest.Mock>
  let service: SupportAlbumService

  beforeEach(() => {
    redis = {
      rpush: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      lrange: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1)
    }
    queue = { add: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue(1) }
    service = new SupportAlbumService(redis as never, queue as never)
  })

  it('ignores a message that belongs to no album', async () => {
    await service.collect({ ...item(1), media_group_id: undefined })

    expect(redis.rpush).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  /**
   * The delay cannot be waited out inside the webhook request: Telegram holds a
   * chat's next update until the current one is answered, so a request waiting
   * for the rest of an album blocks the items it is waiting for.
   */
  it('buffers the item and arms a delayed flush', async () => {
    await service.collect(item(7))

    expect(redis.rpush).toHaveBeenCalledWith(ITEMS_KEY, expect.stringContaining('"message_id":7'))
    expect(redis.expire).toHaveBeenCalledWith(ITEMS_KEY, 600)
    expect(queue.add).toHaveBeenCalledWith(
      'flush',
      { chatId: CHAT_ID, mediaGroupId: GROUP },
      expect.objectContaining({
        jobId: `${CHAT_ID}_${GROUP}`,
        delay: 2_000,
        // Without attempts the buffer's "hold the items until the send
        // succeeds" design is pointless: nothing would ever come back for them.
        attempts: 3
      })
    )
  })

  /** Each item pushes the flush back, so the window follows the *last* arrival. */
  it('replaces the flush already armed rather than queueing a second', async () => {
    await service.collect(item(7))
    await service.collect(item(8))

    expect(queue.remove).toHaveBeenCalledWith(`${CHAT_ID}_${GROUP}`)
    expect(queue.add).toHaveBeenCalledTimes(2)
  })

  it('still buffers the item when the pending flush cannot be removed', async () => {
    queue.remove.mockRejectedValueOnce(new Error('job is locked'))

    await expect(service.collect(item(7))).resolves.toBeUndefined()
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  /**
   * BullMQ reserves `:` as its Redis key separator and throws on a custom id
   * containing one — inside `add`, so the webhook 500s and Telegram redelivers
   * the item forever. That shipped once.
   */
  it('builds a job id Redis will accept, negative chat ids included', async () => {
    const service = new SupportAlbumService(redis as never, queue as never)

    await service.collect({ ...item(7), chat: { id: -1_002_345_678_901, type: 'supergroup' } })

    const { jobId } = queue.add.mock.calls[0][2]
    expect(jobId).not.toContain(':')
    expect(jobId).toBe(`-1002345678901_${GROUP}`)
  })

  /**
   * A webhook that fails after the item was buffered is redelivered, and the
   * item pushed again. Without dedupe the album goes out with a photo twice.
   */
  it('returns one entry per message even when an item was buffered twice', async () => {
    redis.lrange.mockResolvedValue([
      JSON.stringify(item(11)),
      JSON.stringify(item(11)),
      JSON.stringify(item(12))
    ])

    const album = await service.take(CHAT_ID, GROUP)

    expect(album.items.map((message) => message.message_id)).toEqual([11, 12])
  })

  /** Arrival order need not be the order the user assembled the album in. */
  it('returns the items sorted by message id', async () => {
    redis.lrange.mockResolvedValue([JSON.stringify(item(13)), JSON.stringify(item(11))])

    const album = await service.take(CHAT_ID, GROUP)

    expect(album.items.map((message) => message.message_id)).toEqual([11, 13])
  })

  /**
   * The buffer outlives the send on purpose: a failure leaves the items for the
   * job's retry to find. Clearing on read would deliver an album missing two of
   * its three photos.
   */
  it('does not drop the buffer merely because it was read', async () => {
    redis.lrange.mockResolvedValue([JSON.stringify(item(11))])

    await service.take(CHAT_ID, GROUP)

    expect(redis.del).not.toHaveBeenCalled()
  })

  it('drops it once the album is settled', async () => {
    await service.settle({ chatId: CHAT_ID, mediaGroupId: GROUP, items: [] })

    expect(redis.del).toHaveBeenCalledWith(ITEMS_KEY)
  })
})
