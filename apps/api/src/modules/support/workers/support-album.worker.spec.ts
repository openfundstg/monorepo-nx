import { SupportAlbumWorker } from './support-album.worker'
import { SupportLocale } from 'src/shared/constants'
import type { Job } from 'bullmq'
import type { SupportAlbumJobData } from 'src/shared/constants'

const GROUP_ID = -1_002_345_678_901
const USER_ID = 501_234_567
const THREAD_ID = 42

const job = (chatId: number): Job<SupportAlbumJobData> =>
  ({ data: { chatId, mediaGroupId: 'album-1' } }) as Job<SupportAlbumJobData>

const fromUser = {
  message_id: 7,
  chat: { id: USER_ID, type: 'private' },
  from: { id: USER_ID, is_bot: false, first_name: 'Іван' }
}

const fromTopic = {
  message_id: 9,
  chat: { id: GROUP_ID, type: 'supergroup' },
  message_thread_id: THREAD_ID,
  from: { id: 99, is_bot: false, first_name: 'Оператор' }
}

describe('SupportAlbumWorker', () => {
  let albums: { take: jest.Mock; settle: jest.Mock }
  let relay: { relayAlbumToGroup: jest.Mock; relayAlbumToUser: jest.Mock }
  let users: { remember: jest.Mock }
  let worker: SupportAlbumWorker

  beforeEach(() => {
    albums = {
      take: jest.fn().mockResolvedValue({ chatId: USER_ID, mediaGroupId: 'album-1', items: [] }),
      settle: jest.fn().mockResolvedValue(undefined)
    }
    relay = {
      relayAlbumToGroup: jest.fn().mockResolvedValue(undefined),
      relayAlbumToUser: jest.fn().mockResolvedValue(undefined)
    }
    users = { remember: jest.fn().mockResolvedValue(SupportLocale.UK) }

    worker = new SupportAlbumWorker(
      albums as never,
      relay as never,
      users as never,
      { groupId: GROUP_ID } as never
    )
  })

  /**
   * The direction is not in the job — it is read off the buffered updates, so
   * one queue serves both sides and the job stays a pair of ids.
   */
  it('sends an album from a private chat into the group', async () => {
    albums.take.mockResolvedValue({ chatId: USER_ID, mediaGroupId: 'album-1', items: [fromUser] })

    await worker.process(job(USER_ID))

    expect(relay.relayAlbumToGroup).toHaveBeenCalledWith(
      expect.anything(),
      fromUser.from,
      SupportLocale.UK
    )
  })

  it('sends an album from a topic to the user it belongs to', async () => {
    albums.take.mockResolvedValue({ chatId: GROUP_ID, mediaGroupId: 'album-1', items: [fromTopic] })

    await worker.process(job(GROUP_ID))

    expect(relay.relayAlbumToUser).toHaveBeenCalledWith(expect.anything(), THREAD_ID)
  })

  /** Two flushes can be armed if an item lands as one starts. The second no-ops. */
  it('does nothing when the album has already been delivered and settled', async () => {
    await worker.process(job(USER_ID))

    expect(relay.relayAlbumToGroup).not.toHaveBeenCalled()
    expect(relay.relayAlbumToUser).not.toHaveBeenCalled()
  })

  /** Left in the buffer it would be retried forever; there is nowhere to send it. */
  it('drops an album that belongs to neither side of the relay', async () => {
    albums.take.mockResolvedValue({
      chatId: -1,
      mediaGroupId: 'album-1',
      items: [{ ...fromTopic, chat: { id: -1, type: 'supergroup' } }]
    })

    await worker.process(job(-1))

    expect(albums.settle).toHaveBeenCalledTimes(1)
    expect(relay.relayAlbumToUser).not.toHaveBeenCalled()
  })
})
