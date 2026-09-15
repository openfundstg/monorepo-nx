import { SupportRelayService } from './support-relay.service'
import { SupportLocale, SupportTopicTitleState } from 'src/shared/constants'
import { TelegramChatType } from 'src/shared/interfaces'
import type { TelegramMessage, TelegramUser } from 'src/shared/interfaces'

const GROUP_ID = -1_002_345_678_901
const USER_ID = 501_234_567
const THREAD_ID = 42

const user = (over: Record<string, unknown> = {}): TelegramUser =>
  ({ id: USER_ID, is_bot: false, first_name: 'Іван', ...over }) as TelegramUser

const userMessage = (): TelegramMessage =>
  ({
    message_id: 7,
    date: 1_780_000_000,
    from: user(),
    chat: { id: USER_ID, type: TelegramChatType.PRIVATE }
  }) as TelegramMessage

const adminMessage = (): TelegramMessage =>
  ({
    message_id: 8,
    date: 1_780_000_000,
    from: { id: 99, is_bot: false, first_name: 'Оператор' },
    chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
    message_thread_id: THREAD_ID
  }) as TelegramMessage

const telegramError = (code: number, description: string) =>
  Object.assign(new Error(`Request failed with status code ${code}`), {
    isAxiosError: true,
    response: { data: { ok: false, error_code: code, description } }
  })

describe('SupportRelayService', () => {
  let topics: {
    ensureOpenTopic: jest.Mock
    recreateTopic: jest.Mock
    reopenThread: jest.Mock
    applyState: jest.Mock
  }
  let db: Record<string, jest.Mock>
  let links: Record<string, jest.Mock>
  let api: Record<string, jest.Mock>
  let albums: { collect: jest.Mock; settle: jest.Mock }
  let menu: { sendText: jest.Mock }
  let service: SupportRelayService

  beforeEach(() => {
    topics = {
      ensureOpenTopic: jest.fn().mockResolvedValue({ threadId: THREAD_ID, created: false }),
      recreateTopic: jest.fn().mockResolvedValue(77),
      reopenThread: jest.fn().mockResolvedValue(undefined),
      applyState: jest.fn().mockResolvedValue(undefined)
    }
    db = {
      findByThreadId: jest.fn().mockResolvedValue({ telegramId: USER_ID }),
      touchUserMessage: jest.fn().mockResolvedValue(undefined),
      touchAdminMessage: jest.fn().mockResolvedValue(undefined)
    }
    links = {
      link: jest.fn().mockResolvedValue(undefined),
      findGroupMessageId: jest.fn().mockResolvedValue(null),
      findUserMessageId: jest.fn().mockResolvedValue(null)
    }
    api = {
      copyMessage: jest.fn().mockResolvedValue({ message_id: 101 }),
      sendMediaGroup: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 102 })
    }

    albums = {
      collect: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined)
    }
    menu = { sendText: jest.fn().mockResolvedValue(undefined) }

    service = new SupportRelayService(
      topics as never,
      db as never,
      links as never,
      albums as never,
      menu as never,
      api as never,
      { requireGroupId: () => GROUP_ID } as never
    )
  })

  describe('user → group', () => {
    /**
     * A copy, not a forward: Telegram gives `forwardMessage` no
     * `reply_parameters`, so a forwarded message could never be shown as the
     * reply the user wrote.
     */
    it('copies into the user’s topic and records the pair', async () => {
      await service.relayToGroup(userMessage(), user(), SupportLocale.UK)

      expect(api.copyMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: GROUP_ID,
          message_thread_id: THREAD_ID,
          from_chat_id: USER_ID,
          message_id: 7
        })
      )
      // 7 in the private chat is 101 in the group; without the pair a later
      // reply to it could not be quoted.
      expect(links.link).toHaveBeenCalledWith(USER_ID, THREAD_ID, 7, 101)
      expect(topics.applyState).toHaveBeenCalledWith(USER_ID, SupportTopicTitleState.OPEN)
    })

    it('quotes the group-side twin of whatever the user replied to', async () => {
      links.findGroupMessageId.mockResolvedValue(555)

      await service.relayToGroup(
        { ...userMessage(), reply_to_message: { message_id: 3 } } as never,
        user(),
        SupportLocale.UK
      )

      expect(links.findGroupMessageId).toHaveBeenCalledWith(USER_ID, 3)
      expect(api.copyMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_parameters: { message_id: 555, allow_sending_without_reply: true }
        })
      )
    })

    /**
     * A reply to the bot's own greeting, or to something older than the links
     * are kept, has no twin. The message still goes — just unquoted.
     */
    it('delivers an unquotable reply anyway', async () => {
      await service.relayToGroup(
        { ...userMessage(), reply_to_message: { message_id: 3 } } as never,
        user(),
        SupportLocale.UK
      )

      expect(api.copyMessage).toHaveBeenCalledWith(
        expect.objectContaining({ reply_parameters: undefined })
      )
    })

    it('acknowledges only the message that opened the conversation', async () => {
      topics.ensureOpenTopic.mockResolvedValue({ threadId: THREAD_ID, created: true })
      await service.relayToGroup(userMessage(), user(), SupportLocale.UK)
      expect(menu.sendText).toHaveBeenCalledTimes(1)

      menu.sendText.mockClear()
      topics.ensureOpenTopic.mockResolvedValue({ threadId: THREAD_ID, created: false })
      await service.relayToGroup(userMessage(), user(), SupportLocale.UK)
      expect(menu.sendText).not.toHaveBeenCalled()
    })

    /**
     * The question is already in the group by the time the acknowledgement is
     * sent, so failing here would cost a redelivery — and put the question in
     * twice to get one courtesy line in once.
     */
    it('does not fail a delivered message because the acknowledgement failed', async () => {
      topics.ensureOpenTopic.mockResolvedValue({ threadId: THREAD_ID, created: true })
      menu.sendText.mockRejectedValueOnce(new Error('telegram is down'))

      await expect(
        service.relayToGroup(userMessage(), user(), SupportLocale.UK)
      ).resolves.toBeUndefined()
    })

    it('rebuilds a deleted topic and copies again, against the new thread', async () => {
      api.copyMessage
        .mockRejectedValueOnce(telegramError(400, 'Bad Request: message thread not found'))
        .mockResolvedValueOnce({ message_id: 100 })

      await service.relayToGroup(userMessage(), user(), SupportLocale.UK)

      expect(topics.recreateTopic).toHaveBeenCalledTimes(1)
      expect(api.copyMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ message_thread_id: 77 })
      )
      // The link must name the thread it actually landed in, not the dead one.
      expect(links.link).toHaveBeenCalledWith(USER_ID, 77, 7, 100)
    })

    /**
     * An admin who closes a topic with the UI's Close button rather than
     * `/close` leaves our records saying `OPEN`. Without this branch the
     * owner's next message fails on every retry and never arrives.
     */
    it('reopens a topic closed outside /close and copies again', async () => {
      api.copyMessage
        .mockRejectedValueOnce(telegramError(400, 'Bad Request: TOPIC_CLOSED'))
        .mockResolvedValueOnce({ message_id: 100 })

      await service.relayToGroup(userMessage(), user(), SupportLocale.UK)

      expect(topics.reopenThread).toHaveBeenCalledWith(THREAD_ID)
      expect(api.copyMessage).toHaveBeenCalledTimes(2)
    })

  })

  describe('albums', () => {
    const albumItem = (messageId: number, over: Record<string, unknown> = {}) =>
      ({
        message_id: messageId,
        date: 1_780_000_000,
        from: user(),
        chat: { id: USER_ID, type: TelegramChatType.PRIVATE },
        media_group_id: 'album-1',
        photo: [{ file_id: `f${messageId}`, file_unique_id: 'u', width: 1, height: 1 }],
        ...over
      }) as never

    beforeEach(() => {
      api.sendMediaGroup = jest.fn().mockResolvedValue([{ message_id: 201 }, { message_id: 202 }])
    })

    const album = (items: unknown[]) =>
      ({ chatId: USER_ID, mediaGroupId: 'album-1', items }) as never

    /**
     * An item only ever gets buffered here. The send happens later, from the
     * flush job — Telegram holds the next update until this one is answered, so
     * waiting for the rest of the album inside the request would prevent it.
     */
    it('only buffers an album item, and sends nothing yet', async () => {
      await service.relayToGroup(albumItem(7), user(), SupportLocale.UK)

      expect(albums.collect).toHaveBeenCalledTimes(1)
      expect(api.sendMediaGroup).not.toHaveBeenCalled()
      expect(api.copyMessage).not.toHaveBeenCalled()
    })

    it('sends the gathered album as one album, in one call', async () => {
      await service.relayAlbumToGroup(
        album([albumItem(7), albumItem(8)]),
        user(),
        SupportLocale.UK
      )

      expect(api.sendMediaGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: GROUP_ID,
          message_thread_id: THREAD_ID,
          media: [
            { type: 'photo', media: 'f7' },
            { type: 'photo', media: 'f8' }
          ]
        })
      )
      expect(api.copyMessage).not.toHaveBeenCalled()
    })

    /**
     * A pair per item, so replying to the third photo quotes the third photo.
     * The zip is only correct because both sides keep the same order.
     */
    it('records a pair for every item of the album', async () => {
      await service.relayAlbumToGroup(
        album([albumItem(7), albumItem(8)]),
        user(),
        SupportLocale.UK
      )

      expect(links.link).toHaveBeenCalledWith(USER_ID, THREAD_ID, 7, 201)
      expect(links.link).toHaveBeenCalledWith(USER_ID, THREAD_ID, 8, 202)
      expect(albums.settle).toHaveBeenCalledTimes(1)
    })

    /** `copyMessages` would keep the grouping but could never carry this. */
    it('makes the whole album a reply when one of its items was one', async () => {
      links.findGroupMessageId.mockResolvedValue(555)

      await service.relayAlbumToGroup(
        album([albumItem(7), albumItem(8, { reply_to_message: { message_id: 3 } })]),
        user(),
        SupportLocale.UK
      )

      expect(api.sendMediaGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_parameters: { message_id: 555, allow_sending_without_reply: true }
        })
      )
    })

    /** An album is not a lesser message: it gets the same topic recovery. */
    it('rebuilds a deleted topic and resends the album against the new thread', async () => {
      api.sendMediaGroup
        .mockRejectedValueOnce(telegramError(400, 'Bad Request: message thread not found'))
        .mockResolvedValueOnce([{ message_id: 301 }, { message_id: 302 }])

      await service.relayAlbumToGroup(
        album([albumItem(7), albumItem(8)]),
        user(),
        SupportLocale.UK
      )

      expect(topics.recreateTopic).toHaveBeenCalledTimes(1)
      expect(api.sendMediaGroup).toHaveBeenLastCalledWith(
        expect.objectContaining({ message_thread_id: 77 })
      )
      expect(links.link).toHaveBeenCalledWith(USER_ID, 77, 7, 301)
    })

    /**
     * An album holding something this relay cannot describe still gets through
     * — item by item, grouping lost, nothing else.
     */
    it('falls back to copying item by item when it cannot describe the media', async () => {
      await service.relayAlbumToGroup(
        album([albumItem(7), albumItem(8, { photo: undefined, sticker: { file_id: 's' } })]),
        user(),
        SupportLocale.UK
      )

      expect(api.sendMediaGroup).not.toHaveBeenCalled()
      expect(api.copyMessage).toHaveBeenCalledTimes(2)
    })

    it('sends an operator’s album to the user as an album', async () => {
      const adminAlbumItem = (messageId: number) =>
        ({
          message_id: messageId,
          date: 1_780_000_000,
          from: { id: 99, is_bot: false, first_name: 'Оператор' },
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
          message_thread_id: THREAD_ID,
          media_group_id: 'album-2',
          photo: [{ file_id: `g${messageId}`, file_unique_id: 'u', width: 1, height: 1 }]
        }) as never

      await service.relayAlbumToUser(
        { chatId: GROUP_ID, mediaGroupId: 'album-2', items: [adminAlbumItem(9), adminAlbumItem(10)] } as never,
        THREAD_ID
      )

      expect(api.sendMediaGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: USER_ID,
          media: [
            { type: 'photo', media: 'g9' },
            { type: 'photo', media: 'g10' }
          ]
        })
      )
      // Sent by the bot, never copied out of the group: nothing in the result
      // names where the files came from.
      expect(api.sendMediaGroup.mock.calls[0][0]).not.toHaveProperty('from_chat_id')
    })
  })

  describe('group → user', () => {
    /**
     * A copy, never a forward: a forward out of the group stamps the message
     * "Forwarded from …" with the title of a group the user must never learn
     * exists.
     */
    it('copies the admin’s message to the user', async () => {
      await service.relayToUser(adminMessage(), THREAD_ID)

      expect(api.copyMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chat_id: USER_ID, from_chat_id: GROUP_ID, message_id: 8 })
      )
      expect(db.touchAdminMessage).toHaveBeenCalledWith(THREAD_ID)
      expect(links.link).toHaveBeenCalledWith(USER_ID, THREAD_ID, 101, 8)
    })

    it('quotes the user-side twin of whatever the operator replied to', async () => {
      links.findUserMessageId.mockResolvedValue(42)

      await service.relayToUser(
        { ...adminMessage(), reply_to_message: { message_id: 9 } } as never,
        THREAD_ID
      )

      expect(links.findUserMessageId).toHaveBeenCalledWith(9)
      expect(api.copyMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_parameters: { message_id: 42, allow_sending_without_reply: true }
        })
      )
    })

    it('tells the thread when it is mapped to nobody', async () => {
      db.findByThreadId.mockResolvedValue(null)

      await service.relayToUser(adminMessage(), THREAD_ID)

      expect(api.copyMessage).not.toHaveBeenCalled()
      expect(api.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message_thread_id: THREAD_ID })
      )
    })

    /** Permanent: retrying would never succeed, so the admin is told instead. */
    it('reports a blocked user in the topic rather than failing the delivery', async () => {
      api.copyMessage.mockRejectedValueOnce(
        telegramError(403, 'Forbidden: bot was blocked by the user')
      )

      await expect(service.relayToUser(adminMessage(), THREAD_ID)).resolves.toBeUndefined()
      expect(api.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('заблокував бота') })
      )
      expect(db.touchAdminMessage).not.toHaveBeenCalled()
    })

    /**
     * Transient: rethrowing costs a 5xx and buys a redelivery, which is how the
     * reply eventually lands instead of being replaced by an apology.
     */
    it('rethrows a rate limit so Telegram redelivers the update', async () => {
      api.copyMessage.mockRejectedValueOnce(telegramError(429, 'Too Many Requests: retry after 5'))

      await expect(service.relayToUser(adminMessage(), THREAD_ID)).rejects.toBeDefined()
    })
  })
})
