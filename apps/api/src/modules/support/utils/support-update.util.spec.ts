import { SupportCommand, SupportUpdateKind } from 'src/modules/support/enums'
import { TelegramChatType } from 'src/shared/interfaces'
import type { TelegramMessage, TelegramUpdate } from 'src/shared/interfaces'
import { classifyUpdate, commandOf, parseTelegramUpdate, profileOf } from './support-update.util'

const GROUP_ID = -1_002_345_678_901
const USER_ID = 501_234_567

const user = (over: Record<string, unknown> = {}) => ({
  id: USER_ID,
  is_bot: false,
  first_name: 'Іван',
  ...over
})

const message = (over: Record<string, unknown> = {}): TelegramMessage =>
  ({
    message_id: 7,
    date: 1_780_000_000,
    from: user(),
    chat: { id: USER_ID, type: TelegramChatType.PRIVATE },
    ...over
  }) as TelegramMessage

const update = (over: Record<string, unknown> = {}): TelegramUpdate =>
  ({ update_id: 1, message: message(), ...over }) as TelegramUpdate

describe('classifyUpdate', () => {
  it('reads a private message as coming from the user', () => {
    const classified = classifyUpdate(update(), GROUP_ID)

    expect(classified.kind).toBe(SupportUpdateKind.USER_MESSAGE)
  })

  it('reads a message inside a group topic as coming from an admin', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP, is_forum: true },
          message_thread_id: 42,
          from: user({ id: 99, first_name: 'Оператор' })
        })
      }),
      GROUP_ID
    )

    expect(classified).toMatchObject({ kind: SupportUpdateKind.ADMIN_MESSAGE, threadId: 42 })
  })

  /**
   * The General thread has no topic id, so there is nobody to deliver to. A
   * looser match would send an admin's aside to whichever user happened to be
   * mapped to thread `undefined`.
   */
  it('ignores the group General thread', () => {
    const classified = classifyUpdate(
      update({
        message: message({ chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP } })
      }),
      GROUP_ID
    )

    expect(classified.kind).toBe(SupportUpdateKind.IGNORED)
  })

  /**
   * …unless it answers something, which in General can only be one of the
   * bot's own alerts — nothing else is posted there.
   */
  it('reads a reply in General as an answer to the bot', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
          from: user({ id: 99, first_name: 'Оператор' }),
          reply_to_message: { message_id: 4_411 },
          text: '+'
        })
      }),
      GROUP_ID
    )

    expect(classified).toMatchObject({
      kind: SupportUpdateKind.GROUP_REPLY,
      replyToId: 4_411
    })
  })

  /**
   * A topic is one person's conversation and everything in it is relayed to
   * them, quote or no quote — which is how an operator normally answers.
   */
  it('keeps a reply inside a topic on the relay path', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP, is_forum: true },
          message_thread_id: 42,
          from: user({ id: 99, first_name: 'Оператор' }),
          reply_to_message: { message_id: 4_411 },
          text: '+'
        })
      }),
      GROUP_ID
    )

    expect(classified).toMatchObject({ kind: SupportUpdateKind.ADMIN_MESSAGE, threadId: 42 })
  })

  /** Another group's reply is not ours, however it is shaped. */
  it('ignores a reply from a chat that is not the support group', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: -1_009_999_999_999, type: TelegramChatType.SUPERGROUP },
          from: user({ id: 99, first_name: 'Оператор' }),
          reply_to_message: { message_id: 4_411 },
          text: '+'
        })
      }),
      GROUP_ID
    )

    expect(classified.kind).toBe(SupportUpdateKind.IGNORED)
  })

  /**
   * Telegram posts one of these into the group the instant our own bot creates
   * a topic. Relaying it would send every user the paperwork for their own
   * thread.
   */
  it('ignores forum service messages', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
          message_thread_id: 42,
          forum_topic_created: { name: '[Support] Іван', icon_color: 0x6fb9f0 }
        })
      }),
      GROUP_ID
    )

    expect(classified.kind).toBe(SupportUpdateKind.IGNORED)
  })

  /** A second bot in the group must not have its output relayed as an operator's. */
  it('ignores other bots', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: GROUP_ID, type: TelegramChatType.SUPERGROUP },
          message_thread_id: 42,
          from: user({ id: 4242, is_bot: true })
        })
      }),
      GROUP_ID
    )

    expect(classified.kind).toBe(SupportUpdateKind.IGNORED)
  })

  it('ignores a group that is not the support group', () => {
    const classified = classifyUpdate(
      update({
        message: message({
          chat: { id: -1_009_999_999_999, type: TelegramChatType.SUPERGROUP },
          message_thread_id: 42
        })
      }),
      GROUP_ID
    )

    expect(classified.kind).toBe(SupportUpdateKind.IGNORED)
  })

  it('ignores updates that carry no message at all', () => {
    expect(classifyUpdate({ update_id: 9 }, GROUP_ID).kind).toBe(SupportUpdateKind.IGNORED)
  })
})

describe('commandOf', () => {
  it('reads a bare command', () => {
    expect(commandOf(message({ text: '/close' }))).toBe(SupportCommand.CLOSE)
  })

  /** Telegram appends the bot name whenever a command is typed in a group. */
  it('reads a command addressed to the bot', () => {
    expect(commandOf(message({ text: '/close@transacto_bot done' }))).toBe(SupportCommand.CLOSE)
  })

  it('ignores a command quoted mid-sentence', () => {
    expect(commandOf(message({ text: 'напишіть /close щоб закрити' }))).toBeUndefined()
  })

  it('ignores an unknown command', () => {
    expect(commandOf(message({ text: '/ban' }))).toBeUndefined()
  })

  it('ignores a message with no text', () => {
    expect(commandOf(message())).toBeUndefined()
  })
})

describe('parseTelegramUpdate', () => {
  it('accepts a body with a numeric update_id', () => {
    expect(parseTelegramUpdate({ update_id: 5 })).toEqual({ update_id: 5 })
  })

  it.each([[null], [undefined], ['{}'], [{}], [{ update_id: '5' }]])(
    'rejects %p',
    (body: unknown) => {
      expect(parseTelegramUpdate(body)).toBeNull()
    }
  )
})

describe('profileOf', () => {
  it('fills every absent field with an empty string', () => {
    expect(profileOf(user() as never)).toEqual({
      firstName: 'Іван',
      lastName: '',
      username: '',
      languageCode: ''
    })
  })
})
