/** Which side of the conversation an inbound update came from. */
export enum SupportUpdateKind {
  /** A user writing to the bot in their private chat. */
  USER_MESSAGE = 'USER_MESSAGE',
  /** An admin writing inside a topic of the support group. */
  ADMIN_MESSAGE = 'ADMIN_MESSAGE',
  /**
   * An admin replying to something in the group's General thread — which is
   * where this bot posts its alerts and nothing else.
   *
   * Told apart from {@link ADMIN_MESSAGE} by having no topic at all. A topic is
   * one user's conversation and everything written in it is relayed to them; a
   * reply in General is an answer to the bot, and today the only answer it
   * takes is `+` under a tail alert.
   */
  GROUP_REPLY = 'GROUP_REPLY',
  /** A user pressing an inline key — today, always a language choice. */
  CALLBACK_QUERY = 'CALLBACK_QUERY',
  /**
   * A line Telegram wrote into the group about a topic being renamed, closed
   * or reopened. Ours to clean up — see `SupportTopicService.dropServiceNotice`.
   */
  SERVICE_NOTICE = 'SERVICE_NOTICE',
  /** Everything else — service messages, other chats, other bots, unanswered General. */
  IGNORED = 'IGNORED'
}
