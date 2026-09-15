import { SupportTopicService } from './support-topic.service'
import { SupportTopicStatus, SupportTopicTitleState } from 'src/shared/constants'
import type { TelegramUser } from 'src/shared/interfaces'
import { topicIconOf } from 'src/modules/support/utils'

const GROUP_ID = -1_002_345_678_901
const USER_ID = 501_234_567
const THREAD_ID = 42

const user = (over: Record<string, unknown> = {}): TelegramUser =>
  ({ id: USER_ID, is_bot: false, first_name: 'Іван', ...over }) as TelegramUser

const stored = (over: Record<string, unknown> = {}) =>
  ({
    telegramId: USER_ID,
    messageThreadId: THREAD_ID,
    status: SupportTopicStatus.OPEN,
    displayName: 'Іван',
    titleWritten: 'Іван',
    titleState: SupportTopicTitleState.OPEN,
    ...over
  }) as never

/** The 400 Telegram answers with once a topic has been deleted in the group. */
const threadGone = () =>
  Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    response: {
      data: { ok: false, error_code: 400, description: 'Bad Request: message thread not found' }
    }
  })

describe('SupportTopicService', () => {
  let db: Record<string, jest.Mock>
  let api: Record<string, jest.Mock>
  let redis: { set: jest.Mock; del: jest.Mock }
  let service: SupportTopicService

  beforeEach(() => {
    db = {
      findByTelegramId: jest.fn().mockResolvedValue(null),
      createTopic: jest.fn().mockResolvedValue(stored()),
      replaceThread: jest.fn().mockResolvedValue(undefined),
      markOpen: jest.fn().mockResolvedValue(undefined),
      markClosed: jest.fn().mockResolvedValue(undefined),
      findByThreadId: jest.fn().mockResolvedValue(null),
      setTitle: jest.fn().mockResolvedValue(undefined)
    }
    api = {
      createForumTopic: jest.fn().mockResolvedValue({ message_thread_id: THREAD_ID }),
      reopenForumTopic: jest.fn().mockResolvedValue(true),
      closeForumTopic: jest.fn().mockResolvedValue(true),
      editForumTopic: jest.fn().mockResolvedValue(true),
      deleteMessage: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 })
    }
    redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) }

    service = new SupportTopicService(
      db as never,
      api as never,
      { requireGroupId: () => GROUP_ID } as never,
      redis as never
    )
  })

  it('creates a topic and introduces the user when there is none', async () => {
    const resolved = await service.ensureOpenTopic(user({ last_name: 'Петренко' }))

    expect(resolved).toEqual({ threadId: THREAD_ID, created: true })
    expect(api.createForumTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: GROUP_ID,
        name: 'Іван Петренко',
        icon_custom_emoji_id: expect.any(String)
      })
    )
    expect(api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message_thread_id: THREAD_ID })
    )
  })

  /**
   * Permanent, and reported as a bare 400 — "Request failed with status code
   * 400" in the logs and nothing else. Every user's every message fails this
   * way until Topics are switched on, so it is worth naming.
   */
  it('says plainly when the group has no Topics, and still lets Telegram retry', async () => {
    const errorLog = jest.spyOn(service['logger'], 'error').mockImplementation()
    api.createForumTopic.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: {
          data: { ok: false, error_code: 400, description: 'Bad Request: the chat is not a forum' }
        }
      })
    )

    await expect(service.ensureOpenTopic(user())).rejects.toBeDefined()
    expect(errorLog.mock.calls[0][0]).toContain('Topics')
  })

  /**
   * A topic titled in the old format — the state as an emoji in front of the
   * name — has to be rewritten even though neither the name nor the state has
   * changed. Comparing against the title actually written is what notices.
   */
  it('rewrites a title left over from the old format', async () => {
    db.findByTelegramId.mockResolvedValue(stored({ titleWritten: '🔴 Іван' }))

    await service.applyState(USER_ID, SupportTopicTitleState.OPEN)

    expect(api.editForumTopic).toHaveBeenCalledWith(expect.objectContaining({ name: 'Іван' }))
  })

  /** An icon is decoration; the message behind it is not. */
  it('opens the topic without an icon rather than not at all', async () => {
    api.createForumTopic
      .mockRejectedValueOnce(
        Object.assign(new Error('400'), {
          isAxiosError: true,
          response: { data: { ok: false, error_code: 400, description: 'Bad Request: STICKER_INVALID' } }
        })
      )
      .mockResolvedValueOnce({ message_thread_id: THREAD_ID })

    await expect(service.ensureOpenTopic(user())).resolves.toMatchObject({ created: true })
    expect(api.createForumTopic).toHaveBeenLastCalledWith(
      expect.objectContaining({ icon_color: expect.any(Number) })
    )
  })

  it('reuses an open topic without touching Telegram', async () => {
    db.findByTelegramId.mockResolvedValue(stored())

    const resolved = await service.ensureOpenTopic(user())

    expect(resolved).toEqual({ threadId: THREAD_ID, created: false })
    expect(api.createForumTopic).not.toHaveBeenCalled()
    expect(api.editForumTopic).not.toHaveBeenCalled()
  })

  /** The whole point of closing rather than deleting: the thread comes back. */
  it('reopens a closed topic when its owner writes again', async () => {
    db.findByTelegramId.mockResolvedValue(stored({ status: SupportTopicStatus.CLOSED }))

    const resolved = await service.ensureOpenTopic(user())

    expect(api.reopenForumTopic).toHaveBeenCalledWith({
      chat_id: GROUP_ID,
      message_thread_id: THREAD_ID
    })
    expect(db.markOpen).toHaveBeenCalledWith(USER_ID)
    expect(resolved).toEqual({ threadId: THREAD_ID, created: false })
  })

  /**
   * A topic deleted by hand in the group leaves a row pointing at nothing.
   * Without this branch every later message from that user fails with the same
   * 400, forever.
   */
  it('rebuilds a topic that was deleted in the group', async () => {
    db.findByTelegramId.mockResolvedValue(stored({ status: SupportTopicStatus.CLOSED }))
    api.reopenForumTopic.mockRejectedValueOnce(threadGone())
    api.createForumTopic.mockResolvedValue({ message_thread_id: 77 })

    const resolved = await service.ensureOpenTopic(user())

    expect(resolved.threadId).toBe(77)
    expect(db.replaceThread).toHaveBeenCalledWith(USER_ID, 77, 'Іван')
    expect(db.createTopic).not.toHaveBeenCalled()
  })

  it('renames a topic when the user renamed themselves', async () => {
    db.findByTelegramId.mockResolvedValue(stored({ displayName: 'Іван' }))

    await service.ensureOpenTopic(user({ first_name: 'Іван', last_name: 'Петренко' }))

    expect(api.editForumTopic).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Іван Петренко' })
    )
  })

  /**
   * Every rename posts a service line into the thread. Renaming on each message
   * would leave a conversation that is half notices, which is why the stored
   * title is compared before anything is sent.
   */
  it('says nothing to Telegram when the title would not change', async () => {
    db.findByTelegramId.mockResolvedValue(stored())

    await service.applyState(USER_ID, SupportTopicTitleState.OPEN)

    expect(api.editForumTopic).not.toHaveBeenCalled()
    expect(db.setTitle).not.toHaveBeenCalled()
  })

  /**
   * Only two states exist, and this is why: a marker per turn meant a rename
   * per turn, and Telegram writes a service line into the thread for each one.
   */
  it('does not rename a live conversation as it goes back and forth', async () => {
    db.findByTelegramId.mockResolvedValue(stored())

    await service.applyState(USER_ID, SupportTopicTitleState.OPEN)
    await service.applyState(USER_ID, SupportTopicTitleState.OPEN)

    expect(api.editForumTopic).not.toHaveBeenCalled()
  })

  it('sweeps up a service notice, and shrugs when it may not', async () => {
    api.deleteMessage = jest.fn().mockResolvedValue(true)
    await service.dropServiceNotice(900)
    expect(api.deleteMessage).toHaveBeenCalledWith({ chat_id: GROUP_ID, message_id: 900 })

    api.deleteMessage.mockRejectedValueOnce(new Error('not enough rights'))
    await expect(service.dropServiceNotice(900)).resolves.toBeUndefined()
  })

  it('marks a closed topic in its title too', async () => {
    db.findByThreadId.mockResolvedValue(stored())

    await service.closeTopic(THREAD_ID)

    expect(api.editForumTopic).toHaveBeenCalledWith(
      expect.objectContaining({ icon_custom_emoji_id: topicIconOf(SupportTopicTitleState.CLOSED) })
    )
  })

  /** The title is a convenience; the message behind it is the product. */
  it('does not fail a message because the rename failed', async () => {
    db.findByTelegramId.mockResolvedValue(stored({ displayName: 'stale', titleWritten: 'stale' }))
    api.editForumTopic.mockRejectedValueOnce(new Error('not enough rights'))

    await expect(service.ensureOpenTopic(user())).resolves.toEqual({
      threadId: THREAD_ID,
      created: false
    })
  })

  it('takes the creation lock and releases it', async () => {
    await service.ensureOpenTopic(user())

    expect(redis.set).toHaveBeenCalledWith(
      `support:topic:create:lock:${USER_ID}`,
      '1',
      'PX',
      15_000,
      'NX'
    )
    expect(redis.del).toHaveBeenCalledWith(`support:topic:create:lock:${USER_ID}`)
  })

  /**
   * `createForumTopic` has no idempotency key, so the only way not to create a
   * second thread for the same person is not to call it.
   */
  it('waits for the winner’s row instead of creating a second topic', async () => {
    redis.set.mockResolvedValue(null)
    db.findByTelegramId.mockResolvedValueOnce(null).mockResolvedValue(stored())

    const resolved = await service.ensureOpenTopic(user())

    // `created: false` although a topic was created — by the other request,
    // which has already greeted the user. Saying true here would greet them
    // twice for one conversation.
    expect(resolved).toEqual({ threadId: THREAD_ID, created: false })
    expect(api.createForumTopic).not.toHaveBeenCalled()
  })

  it('marks a topic closed even when Telegram no longer has it', async () => {
    api.closeForumTopic.mockRejectedValueOnce(threadGone())

    await service.closeTopic(THREAD_ID)

    expect(db.markClosed).toHaveBeenCalledWith(THREAD_ID)
  })
})
