import { SupportTopicTitleState } from 'src/shared/constants'
import type { TelegramUser } from 'src/shared/interfaces'
import { buildTopicName, displayNameOf, topicIconOf } from './topic-name.util'

const user = (over: Record<string, unknown> = {}): TelegramUser =>
  ({ id: 501_234_567, is_bot: false, first_name: 'Іван', ...over }) as TelegramUser

describe('displayNameOf', () => {
  it('joins first and last name', () => {
    expect(displayNameOf(user({ last_name: 'Петренко' }))).toBe('Іван Петренко')
  })

  it('falls back to the username when there is no name', () => {
    expect(displayNameOf(user({ first_name: '', username: 'ivan' }))).toBe('@ivan')
  })

  /** `createForumTopic` rejects an empty name with a 400, so there is always something. */
  it('falls back to the numeric id', () => {
    expect(displayNameOf(user({ first_name: '' }))).toBe('501234567')
  })
})

describe('buildTopicName', () => {
  /**
   * The state used to be prefixed here as an emoji, which drew it beside
   * Telegram's own topic icon — two icons and a name on every row of the list.
   * It lives in the icon now.
   */
  it('is the person’s name and nothing else', () => {
    expect(buildTopicName('Іван Петренко')).toBe('Іван Петренко')
  })

  /**
   * The name is the user's to choose. Truncating is what keeps a 200-character
   * display name from turning into a 400 and losing the message behind it.
   */
  it('truncates to Telegram’s 128-character limit', () => {
    expect(buildTopicName('я'.repeat(200))).toHaveLength(128)
  })
})

describe('topicIconOf', () => {
  it('gives each state its own icon', () => {
    const open = topicIconOf(SupportTopicTitleState.OPEN)
    const closed = topicIconOf(SupportTopicTitleState.CLOSED)

    expect(open).not.toBe(closed)
    // Telegram takes these as custom-emoji ids, not as emoji.
    expect(open).toMatch(/^\d+$/)
    expect(closed).toMatch(/^\d+$/)
  })
})
