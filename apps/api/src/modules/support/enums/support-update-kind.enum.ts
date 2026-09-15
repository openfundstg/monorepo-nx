/** Which side of the conversation an inbound update came from. */
export enum SupportUpdateKind {
  /** A user writing to the bot in their private chat. */
  USER_MESSAGE = 'USER_MESSAGE',
  /** An admin writing inside a topic of the support group. */
  ADMIN_MESSAGE = 'ADMIN_MESSAGE',
  /** A user pressing an inline key — today, always a language choice. */
  CALLBACK_QUERY = 'CALLBACK_QUERY',
  /**
   * A line Telegram wrote into the group about a topic being renamed, closed
   * or reopened. Ours to clean up — see `SupportTopicService.dropServiceNotice`.
   */
  SERVICE_NOTICE = 'SERVICE_NOTICE',
  /** Everything else — service messages, other chats, other bots, the General topic. */
  IGNORED = 'IGNORED'
}
