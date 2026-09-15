import { SupportTopicTitleState } from 'src/shared/constants'
import {
  SUPPORT_TOPIC_ICON,
  SupportConfig
} from 'src/modules/support/constants/support.constants'
import type { TelegramUser } from 'src/shared/interfaces'

/**
 * How a user is named to admins.
 *
 * Falls back through everything Telegram might give us and ends at the numeric
 * id, which always exists. An empty title is a 400 from `createForumTopic`, so
 * "there is always something to print" is a correctness requirement, not a
 * nicety.
 */
export const displayNameOf = (user: TelegramUser): string => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()

  if (fullName) return fullName
  if (user.username) return `@${user.username}`

  return String(user.id)
}

/**
 * The topic title: the person's name, and nothing else.
 *
 * State used to be prefixed here as an emoji, which put it next to Telegram's
 * own topic icon and made every row in the list read as two icons and a name.
 * It lives in the icon now — see {@link SUPPORT_TOPIC_ICON}.
 *
 * Truncated to Telegram's 128-character limit rather than left to fail, because
 * the name is the user's to choose and a rejected `createForumTopic` would mean
 * their message is never delivered at all.
 */
export const buildTopicName = (displayName: string): string =>
  displayName.length > SupportConfig.TOPIC_NAME_MAX_LENGTH
    ? displayName.slice(0, SupportConfig.TOPIC_NAME_MAX_LENGTH)
    : displayName

/** The icon that says what state a conversation is in. */
export const topicIconOf = (state: SupportTopicTitleState): string =>
  state === SupportTopicTitleState.CLOSED
    ? SUPPORT_TOPIC_ICON.CLOSED
    : SUPPORT_TOPIC_ICON.OPEN
