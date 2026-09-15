import { SupportService } from './support.service'
import { SupportButton } from 'src/modules/support/enums'
import { SupportLocale } from 'src/shared/constants'
import { TelegramChatType } from 'src/shared/interfaces'
import type { TelegramUpdate } from 'src/shared/interfaces'

const GROUP_ID = -1_002_345_678_901
const USER_ID = 501_234_567

const privateUpdate = (text?: string): TelegramUpdate =>
  ({
    update_id: 11,
    message: {
      message_id: 1,
      date: 1_780_000_000,
      from: { id: USER_ID, is_bot: false, first_name: 'Іван' },
      chat: { id: USER_ID, type: TelegramChatType.PRIVATE },
      text
    }
  }) as TelegramUpdate

const topicUpdate = (text?: string): TelegramUpdate =>
  ({
    update_id: 12,
    message: {
      message_id: 2,
      date: 1_780_000_000,
      from: { id: 99, is_bot: false, first_name: 'Оператор' },
      chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
      message_thread_id: 42,
      text
    }
  }) as TelegramUpdate

describe('SupportService', () => {
  let redis: { set: jest.Mock; del: jest.Mock }
  let relay: { relayToGroup: jest.Mock; relayToUser: jest.Mock; confirmClose: jest.Mock }
  let topics: { closeTopic: jest.Mock }
  let menu: { sendGreeting: jest.Mock; handleButton: jest.Mock; handleLanguageChoice: jest.Mock }
  let users: { remember: jest.Mock }
  let fiatWatch: { handleUnsubscribe: jest.Mock }
  let service: SupportService

  beforeEach(() => {
    redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) }
    relay = {
      relayToGroup: jest.fn().mockResolvedValue(undefined),
      relayToUser: jest.fn().mockResolvedValue(undefined),
      confirmClose: jest.fn().mockResolvedValue(undefined)
    }
    topics = { closeTopic: jest.fn().mockResolvedValue(undefined) }
    menu = {
      sendGreeting: jest.fn().mockResolvedValue(undefined),
      handleButton: jest.fn().mockResolvedValue(undefined),
      handleLanguageChoice: jest.fn().mockResolvedValue(undefined)
    }
    users = { remember: jest.fn().mockResolvedValue(SupportLocale.UK) }
    fiatWatch = { handleUnsubscribe: jest.fn().mockResolvedValue(undefined) }

    service = new SupportService(
      { isEnabled: true, requireGroupId: () => GROUP_ID } as never,
      relay as never,
      topics as never,
      menu as never,
      users as never,
      fiatWatch as never,
      redis as never
    )
  })

  it('relays a user message into the group', async () => {
    await service.handleUpdate(privateUpdate('де мої гроші?'))

    expect(relay.relayToGroup).toHaveBeenCalledTimes(1)
    expect(menu.sendGreeting).not.toHaveBeenCalled()
  })

  /**
   * The same bot hosts the Mini App, so a good share of the people pressing
   * Start are not asking anything. Opening a topic for each of them would fill
   * the group with empty threads.
   */
  it('answers /start without opening a conversation', async () => {
    await service.handleUpdate(privateUpdate('/start'))

    expect(menu.sendGreeting).toHaveBeenCalledWith(expect.anything(), SupportLocale.UK)
    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })

  it('delivers an admin reply to the user it is mapped to', async () => {
    await service.handleUpdate(topicUpdate('вже дивимось'))

    expect(relay.relayToUser).toHaveBeenCalledWith(expect.anything(), 42)
  })

  it('closes the topic on /close instead of relaying it', async () => {
    await service.handleUpdate(topicUpdate('/close'))

    expect(topics.closeTopic).toHaveBeenCalledWith(42)
    expect(relay.confirmClose).toHaveBeenCalledWith(42)
    expect(relay.relayToUser).not.toHaveBeenCalled()
  })

  /**
   * A reply-keyboard press is an ordinary text message carrying the key's
   * label. Relaying it would reach an operator as a one-word question, and the
   * user would get an answer to something they never asked.
   */
  it('acts on a keyboard press instead of relaying it', async () => {
    await service.handleUpdate(privateUpdate('💰 Баланс'))

    expect(menu.handleButton).toHaveBeenCalledWith(
      SupportButton.BALANCE,
      expect.anything(),
      SupportLocale.UK
    )
    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })

  /**
   * The keyboard on screen is whichever language it was drawn in, which need
   * not be the language now stored for that user.
   */
  it('recognises a key from another language’s keyboard', async () => {
    await service.handleUpdate(privateUpdate('📖 Guide'))

    expect(menu.handleButton).toHaveBeenCalledWith(
      SupportButton.GUIDE,
      expect.anything(),
      SupportLocale.UK
    )
    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })

  it('relays ordinary text that merely resembles nothing on the keyboard', async () => {
    await service.handleUpdate(privateUpdate('баланс не оновився'))

    expect(menu.handleButton).not.toHaveBeenCalled()
    expect(relay.relayToGroup).toHaveBeenCalledTimes(1)
  })

  it('routes an inline key press to the language menu', async () => {
    await service.handleUpdate({
      update_id: 13,
      callback_query: {
        id: 'q1',
        chat_instance: 'c1',
        from: { id: USER_ID, is_bot: false, first_name: 'Іван' },
        data: 'lang:en'
      }
    } as never)

    expect(menu.handleLanguageChoice).toHaveBeenCalledTimes(1)
    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })

  /**
   * Telegram redelivers anything it did not get a 2xx for. Without this, a
   * retried delivery — or one arriving while the first is still in flight —
   * would post the same question into the group twice.
   */
  it('drops an update whose key is already taken', async () => {
    redis.set.mockResolvedValueOnce(null)

    await service.handleUpdate(privateUpdate('привіт'))

    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })

  it('extends the key past Telegram’s retry window once the update succeeds', async () => {
    await service.handleUpdate(privateUpdate('привіт'))

    expect(redis.set).toHaveBeenNthCalledWith(1, expect.any(String), '1', 'PX', 60_000, 'NX')
    expect(redis.set).toHaveBeenNthCalledWith(2, expect.any(String), '1', 'EX', 86_400)
  })

  /**
   * The deduplication key is what makes a retry a duplicate. Leaving it in
   * place after a failure would turn a transient Telegram outage into a message
   * that is never delivered and never retried.
   */
  it('releases the key when processing fails, so the retry gets through', async () => {
    relay.relayToGroup.mockRejectedValueOnce(new Error('telegram is down'))

    await expect(service.handleUpdate(privateUpdate('привіт'))).rejects.toThrow('telegram is down')
    expect(redis.del).toHaveBeenCalledTimes(1)
  })

  /** An existing deployment with no support group must keep serving everything else. */
  it('acknowledges and drops updates when support is not configured', async () => {
    const inert = new SupportService(
      { isEnabled: false, requireGroupId: () => GROUP_ID } as never,
      relay as never,
      topics as never,
      menu as never,
      users as never,
      fiatWatch as never,
      redis as never
    )

    await inert.handleUpdate(privateUpdate('привіт'))

    expect(redis.set).not.toHaveBeenCalled()
    expect(relay.relayToGroup).not.toHaveBeenCalled()
  })
})
