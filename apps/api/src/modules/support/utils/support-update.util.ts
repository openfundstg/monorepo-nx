import { SupportCommand, SupportUpdateKind } from 'src/modules/support/enums'
import { TelegramChatType } from 'src/shared/interfaces'
import type {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser
} from 'src/shared/interfaces'
import type { SupportBotUserProfile } from 'src/modules/repositories/support-db/services'

/**
 * An update, decided.
 *
 * A discriminated union rather than a `kind` beside optional fields, so the
 * caller reaches `message`, `from` and `threadId` only on the branch where this
 * function has established they exist. The alternative is a non-null assertion
 * at every call site, which is the same claim without the compiler checking it.
 */
export type ClassifiedUpdate =
  | {
      readonly kind: SupportUpdateKind.USER_MESSAGE
      readonly message: TelegramMessage
      readonly from: TelegramUser
    }
  | {
      readonly kind: SupportUpdateKind.ADMIN_MESSAGE
      readonly message: TelegramMessage
      readonly from: TelegramUser
      readonly threadId: number
    }
  | {
      readonly kind: SupportUpdateKind.CALLBACK_QUERY
      readonly query: TelegramCallbackQuery
      readonly from: TelegramUser
    }
  | { readonly kind: SupportUpdateKind.SERVICE_NOTICE; readonly messageId: number }
  | { readonly kind: SupportUpdateKind.IGNORED }

const IGNORED: ClassifiedUpdate = { kind: SupportUpdateKind.IGNORED }

/**
 * Whether a message is one of Telegram's forum service notices.
 *
 * These arrive in the group whenever a topic is created, renamed, closed or
 * reopened — including by our own bot, seconds after it acts. Relaying them
 * would send every user a copy of their own topic's paperwork.
 */
const isForumServiceMessage = (message: TelegramMessage): boolean =>
  Boolean(
    message.forum_topic_created ??
      message.forum_topic_edited ??
      message.forum_topic_closed ??
      message.forum_topic_reopened
  )

/**
 * The service notices that may be deleted.
 *
 * **`forum_topic_created` is deliberately absent.** Its `message_id` *is* the
 * topic — the thread hangs off that message — so deleting it does not tidy a
 * line, it takes the conversation with it.
 */
const isDeletableNotice = (message: TelegramMessage): boolean =>
  Boolean(
    message.forum_topic_edited ?? message.forum_topic_closed ?? message.forum_topic_reopened
  )

/**
 * Which side an update came from, given the support group's id.
 *
 * Everything not positively identified as one of the two directions is ignored,
 * deliberately: this endpoint is reachable by any update Telegram is configured
 * to send, and the failure mode of a loose match is a message delivered to the
 * wrong person.
 *
 * Bots are excluded on both sides. Telegram does not deliver a bot its own
 * messages, so this is not about our forwards — it is about a second bot in the
 * group (a logger, a poll bot) whose output would otherwise be relayed to a
 * customer as if an operator had written it.
 */
export const classifyUpdate = (update: TelegramUpdate, groupId: number): ClassifiedUpdate => {
  const query = update.callback_query
  // Inline keys are only ever offered to a user in their own chat, so a press
  // needs no chat check — the query carries whoever pressed it.
  if (query && !query.from.is_bot) return { kind: SupportUpdateKind.CALLBACK_QUERY, query, from: query.from }

  const message = update.message
  if (!message) return IGNORED

  // Checked before the sender is: a service notice about our own rename is
  // written by the bot, and the bot filter below would keep it forever.
  if (message.chat.id === groupId && isDeletableNotice(message))
    return { kind: SupportUpdateKind.SERVICE_NOTICE, messageId: message.message_id }

  const from = message.from
  if (!from || from.is_bot) return IGNORED

  if (message.chat.type === TelegramChatType.PRIVATE && message.chat.id === from.id)
    return { kind: SupportUpdateKind.USER_MESSAGE, message, from }

  // Group side: only inside a topic, and never the General thread — a topic id
  // is the entire addressing scheme, and General has none.
  const threadId = message.message_thread_id
  if (message.chat.id === groupId && threadId && !isForumServiceMessage(message))
    return { kind: SupportUpdateKind.ADMIN_MESSAGE, message, from, threadId }

  return IGNORED
}

/**
 * The command a message opens with, if any.
 *
 * Telegram appends `@botname` to a command typed in a group, and a command is
 * only a command at the very start of the text — `/close` quoted mid-sentence
 * by a user is text, not an instruction.
 */
export const commandOf = (message: TelegramMessage): SupportCommand | undefined => {
  const first = message.text?.trim().split(/\s+/)[0]?.toLowerCase()
  if (!first?.startsWith('/')) return undefined

  const bare = first.split('@')[0]

  return Object.values(SupportCommand).find((command) => command === bare)
}

/** The profile snapshot the repository stores, taken off an inbound update. */
export const profileOf = (user: TelegramUser): SupportBotUserProfile => ({
  firstName: user.first_name ?? '',
  lastName: user.last_name ?? '',
  username: user.username ?? '',
  languageCode: user.language_code ?? ''
})

/**
 * Narrows an unvalidated webhook body to an {@link TelegramUpdate}.
 *
 * The body arrives as `unknown` on purpose — see the controller — so this is
 * the only validation it gets. `update_id` is the one field every update
 * carries and the one the deduplication key is built from; anything without it
 * is not an update, whatever else it contains.
 */
export const parseTelegramUpdate = (body: unknown): TelegramUpdate | null => {
  if (typeof body !== 'object' || body === null) return null

  const candidate = body as { update_id?: unknown }

  return typeof candidate.update_id === 'number' ? (body as TelegramUpdate) : null
}
