/**
 * The slice of the Telegram Bot API this backend speaks, as the published
 * specification declares it.
 *
 * `https://api.telegram.org/bot<token>/<method>`. Source of truth is Telegram's
 * own documentation at https://core.telegram.org/bots/api, read against **Bot
 * API 10.3** — a published spec, so these shapes are first-preference material
 * rather than guesses captured off live traffic.
 *
 * **Everything here describes somebody else's wire format.** Fields stay
 * snake_case because that is how they arrive, and a field is optional exactly
 * when Telegram says it may be absent — never because it reads better.
 *
 * Two deliberate limits, stated rather than hidden:
 *
 * 1. **Only the methods the support bot calls are declared**, each with *every*
 *    parameter Telegram accepts, so nothing on offer is invisible to the next
 *    person. Adding a method means adding its full parameter set here.
 * 2. **{@link TelegramMessage} is declared down to identity, threading and the
 *    service messages we branch on, and no further.** The full object carries
 *    roughly ninety fields, almost all of them content — every media type,
 *    every payment and forum service message, entities, quotes, reactions.
 *    None is read: the relay moves messages by `message_id` through
 *    `forwardMessage` and `copyMessage`, which is precisely what lets it carry
 *    a sticker, an invoice or a media group it has never heard of. The
 *    undeclared remainder is named by {@link TelegramMessage} index signature
 *    below, so an unread field is visibly unread rather than assumed absent.
 */

// --- Envelope --------------------------------------------------------------

/**
 * Every response, success or failure.
 *
 * A failure arrives with an HTTP 4xx/5xx status *and* this body, so axios
 * throws and the body is read off `error.response.data`.
 */
export interface TelegramApiResponse<T> {
  readonly ok: boolean
  /** Present exactly when `ok` is true. */
  readonly result?: T
  /** Present exactly when `ok` is false — English, developer-facing, unstable. */
  readonly description?: string
  /** Mirrors the HTTP status in practice, but Telegram treats this as the truth. */
  readonly error_code?: number
  readonly parameters?: TelegramResponseParameters
}

export interface TelegramResponseParameters {
  /** The supergroup this chat was migrated to; the old id is dead. */
  readonly migrate_to_chat_id?: number
  /** Seconds to wait before retrying, on a 429. */
  readonly retry_after?: number
}

// --- Objects ---------------------------------------------------------------

export interface TelegramUser {
  readonly id: number
  readonly is_bot: boolean
  readonly first_name: string
  readonly last_name?: string
  readonly username?: string
  /** IETF tag — `uk`, `ru`, `en`, `en-GB`. Absent if the client did not send one. */
  readonly language_code?: string
  readonly is_premium?: true
  readonly added_to_attachment_menu?: true
  /** Only ever returned by `getMe`. */
  readonly can_join_groups?: boolean
  readonly can_read_all_group_messages?: boolean
  readonly supports_inline_queries?: boolean
  readonly can_connect_to_business?: boolean
  readonly has_main_web_app?: boolean
  readonly supports_guest_queries?: boolean
  readonly supports_join_request_queries?: boolean
}

/** `chat.type`. A forum lives in a `supergroup`; a user writes from a `private`. */
export enum TelegramChatType {
  PRIVATE = 'private',
  GROUP = 'group',
  SUPERGROUP = 'supergroup',
  CHANNEL = 'channel',
  SENDER = 'sender'
}

/**
 * The `Chat` as it appears inside a `Message` — Telegram's own
 * `ChatFullInfo` is a much larger object returned only by `getChat`, which
 * nothing here calls.
 */
export interface TelegramChat {
  readonly id: number
  readonly type: TelegramChatType
  readonly title?: string
  readonly username?: string
  readonly first_name?: string
  readonly last_name?: string
  /** True for a supergroup with the Topics feature switched on. */
  readonly is_forum?: true
  readonly is_direct_messages?: true
}

/** What `createForumTopic` returns. */
export interface TelegramForumTopic {
  readonly message_thread_id: number
  readonly name: string
  /** One of Telegram's six fixed topic colours, as a 24-bit RGB integer. */
  readonly icon_color: number
  readonly icon_custom_emoji_id?: string
}

/** Service message: a topic was created in this chat. */
export interface TelegramForumTopicCreated {
  readonly name: string
  readonly icon_color: number
  readonly icon_custom_emoji_id?: string
}

/** Service message: a topic was renamed or re-iconed. Both fields optional. */
export interface TelegramForumTopicEdited {
  readonly name?: string
  readonly icon_custom_emoji_id?: string
}

/** Service messages with no fields of their own — the presence *is* the signal. */
export type TelegramForumTopicClosed = Record<string, never>
export type TelegramForumTopicReopened = Record<string, never>

// --- Keyboards -------------------------------------------------------------

/** A Mini App to open. The URL must be HTTPS and match the app configured for the bot. */
export interface TelegramWebAppInfo {
  readonly url: string
}

/**
 * One key of the persistent keyboard shown under a user's input field.
 *
 * Pressing a plain one **sends its `text` to the chat as an ordinary message** —
 * there is no callback and no marker distinguishing it from something the user
 * typed by hand. That is the whole reason `buttonOf` exists: a bot that does
 * not recognise its own labels relays them onward as if they were questions.
 */
export interface TelegramKeyboardButton {
  readonly text: string
  readonly request_users?: TelegramKeyboardButtonRequestUsers
  readonly request_chat?: TelegramKeyboardButtonRequestChat
  readonly request_contact?: boolean
  readonly request_location?: boolean
  readonly request_poll?: TelegramKeyboardButtonPollType
  /** Deprecated by Telegram in favour of `request_users`; declared because it is still sent. */
  readonly request_user?: TelegramKeyboardButtonRequestUsers
  /** Private chats only. Opens the Mini App in one tap instead of via a link. */
  readonly web_app?: TelegramWebAppInfo
}

export interface TelegramKeyboardButtonRequestUsers {
  readonly request_id: number
  readonly user_is_bot?: boolean
  readonly user_is_premium?: boolean
  readonly max_quantity?: number
}

export interface TelegramKeyboardButtonRequestChat {
  readonly request_id: number
  readonly chat_is_channel: boolean
  readonly chat_is_forum?: boolean
  readonly chat_has_username?: boolean
  readonly chat_is_created?: boolean
  readonly user_administrator_rights?: unknown
  readonly bot_administrator_rights?: unknown
  readonly bot_is_member?: boolean
}

export interface TelegramKeyboardButtonPollType {
  readonly type?: string
}

export interface TelegramReplyKeyboardMarkup {
  readonly keyboard: readonly (readonly TelegramKeyboardButton[])[]
  /** Keeps the keyboard on screen instead of hiding it behind the ⌨ icon. */
  readonly is_persistent?: boolean
  /** Shrinks the keys to fit their labels; without it they are comically tall. */
  readonly resize_keyboard?: boolean
  readonly one_time_keyboard?: boolean
  readonly input_field_placeholder?: string
  readonly selective?: boolean
}

export interface TelegramReplyKeyboardRemove {
  readonly remove_keyboard: true
  readonly selective?: boolean
}

/** A key attached to a message rather than to the chat. Sends a callback, not text. */
export interface TelegramInlineKeyboardButton {
  readonly text: string
  readonly url?: string
  /** 1–64 bytes, returned verbatim in {@link TelegramCallbackQuery.data}. */
  readonly callback_data?: string
  readonly web_app?: TelegramWebAppInfo
  readonly login_url?: TelegramLoginUrl
  readonly switch_inline_query?: string
  readonly switch_inline_query_current_chat?: string
  readonly switch_inline_query_chosen_chat?: TelegramSwitchInlineQueryChosenChat
  readonly copy_text?: TelegramCopyTextButton
  /** `CallbackGame` — an empty placeholder object in the specification. */
  readonly callback_game?: Record<string, never>
  readonly pay?: boolean
  /** Documented as `DisabledButton` in Bot API 10.3; unused here, shape not captured. */
  readonly disabled?: unknown
}

export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly TelegramInlineKeyboardButton[])[]
}

export interface TelegramCopyTextButton {
  readonly text: string
}

export interface TelegramLoginUrl {
  readonly url: string
  readonly forward_text?: string
  readonly bot_username?: string
  readonly request_write_access?: boolean
}

export interface TelegramSwitchInlineQueryChosenChat {
  readonly query?: string
  readonly allow_user_chats?: boolean
  readonly allow_bot_chats?: boolean
  readonly allow_group_chats?: boolean
  readonly allow_channel_chats?: boolean
}

/**
 * Everything `reply_markup` accepts. `ForceReply` is the one member Telegram
 * documents that is missing: nothing here asks a user to reply to a specific
 * message, and declaring a shape we never send would be declaring it untested.
 */
export type TelegramReplyMarkup =
  | TelegramInlineKeyboardMarkup
  | TelegramReplyKeyboardMarkup
  | TelegramReplyKeyboardRemove

/**
 * An inline button press.
 *
 * **Must be answered**, with `answerCallbackQuery`, even with an empty text —
 * otherwise the client shows a spinner on the button for up to a minute.
 */
export interface TelegramCallbackQuery {
  readonly id: string
  readonly from: TelegramUser
  /** Absent if the message is older than roughly 48 hours. */
  readonly message?: TelegramMessage
  readonly inline_message_id?: string
  readonly chat_instance: string
  /** The `callback_data` of the button that was pressed. */
  readonly data?: string
  readonly game_short_name?: string
}

// --- Media -----------------------------------------------------------------
//
// These were part of {@link TelegramMessage}'s undeclared remainder until the
// relay started rebuilding albums, which is exactly the moment the file header
// says they must be lifted out: a field this backend reads is a field this
// backend declares.

/** One size of a photo. Telegram sends every size; the last is the largest. */
export interface TelegramPhotoSize {
  readonly file_id: string
  readonly file_unique_id: string
  readonly width: number
  readonly height: number
  readonly file_size?: number
}

export interface TelegramVideo {
  readonly file_id: string
  readonly file_unique_id: string
  readonly width: number
  readonly height: number
  readonly duration: number
  readonly thumbnail?: TelegramPhotoSize
  readonly cover?: readonly TelegramPhotoSize[]
  readonly start_timestamp?: number
  readonly file_name?: string
  readonly mime_type?: string
  readonly file_size?: number
  /** Available renditions. Opaque: nothing here chooses a quality. */
  readonly qualities?: readonly unknown[]
}

export interface TelegramDocument {
  readonly file_id: string
  readonly file_unique_id: string
  readonly thumbnail?: TelegramPhotoSize
  readonly file_name?: string
  readonly mime_type?: string
  readonly file_size?: number
}

export interface TelegramAudio {
  readonly file_id: string
  readonly file_unique_id: string
  readonly duration: number
  readonly performer?: string
  readonly title?: string
  readonly file_name?: string
  readonly mime_type?: string
  readonly file_size?: number
  readonly thumbnail?: TelegramPhotoSize
}

/**
 * One formatted span of a caption or text.
 *
 * Telegram declares this as a union discriminated on `type`, with each member
 * carrying its own extra field. Flattened here because entities are only ever
 * passed through verbatim — an album's caption is re-sent with the entities it
 * arrived with, and nothing reads them. A faithful union would invite code that
 * does.
 */
export interface TelegramMessageEntity {
  readonly type: string
  readonly offset: number
  readonly length: number
  /** `text_link` only. */
  readonly url?: string
  /** `text_mention` only. */
  readonly user?: TelegramUser
  /** `pre` only. */
  readonly language?: string
  /** `custom_emoji` only. */
  readonly custom_emoji_id?: string
  /** `date_time` only. */
  readonly unix_time?: number
  readonly date_time_format?: string
}

/** What `copyMessage` returns: the new message's id, and nothing else. */
export interface TelegramMessageId {
  readonly message_id: number
}

/**
 * A message, declared as far as this backend reads it — see the file header for
 * why that stops where it does.
 */
export interface TelegramMessage {
  readonly message_id: number
  /** Absent for a channel post or an anonymous admin; present for a person. */
  readonly from?: TelegramUser
  /** Set when the sender is a channel or an anonymous group admin. */
  readonly sender_chat?: TelegramChat
  readonly chat: TelegramChat
  /** Unix seconds. */
  readonly date: number
  /** The forum topic this message belongs to. Absent in the group's General topic. */
  readonly message_thread_id?: number
  /** True when the message was sent into a topic rather than the General thread. */
  readonly is_topic_message?: true
  readonly text?: string
  readonly caption?: string
  readonly caption_entities?: readonly TelegramMessageEntity[]
  /**
   * Shared by every item of one album — and the only thing tying them together.
   *
   * Telegram delivers an album as one update **per item**, in no announced
   * quantity and with no "that was the last one" signal. This id is what lets
   * the relay put them back together; see `SupportAlbumService` for how the end
   * of a group is decided.
   */
  readonly media_group_id?: string
  /** Every size Telegram generated. The largest is last. */
  readonly photo?: readonly TelegramPhotoSize[]
  readonly video?: TelegramVideo
  readonly document?: TelegramDocument
  readonly audio?: TelegramAudio
  readonly has_media_spoiler?: true
  readonly show_caption_above_media?: true
  /**
   * The message this one replies to, as far as Telegram will tell us.
   *
   * Its `message_id` is an id **in the chat the reply arrived from**, which is
   * the whole reason `support_message_links` exists: the same message has a
   * different id in the user's chat and in the group, and quoting the raw
   * number in the other chat would quote whatever happens to sit at it.
   */
  readonly reply_to_message?: TelegramMessage
  readonly forum_topic_created?: TelegramForumTopicCreated
  readonly forum_topic_edited?: TelegramForumTopicEdited
  readonly forum_topic_closed?: TelegramForumTopicClosed
  readonly forum_topic_reopened?: TelegramForumTopicReopened
  /**
   * Every remaining field of Telegram's `Message` — all media, entities,
   * forwards, replies, payments and the other service messages.
   *
   * Deliberately opaque, which is not the same as undeclared: the relay never
   * inspects content, it moves a message by id. Anything this backend starts
   * reading must be lifted out of here and declared above.
   */
  readonly [key: string]: unknown
}

/**
 * Makes a message a reply to another one.
 *
 * `allow_sending_without_reply` is the field that matters most here: without
 * it, replying to a message that has since been deleted fails the whole send.
 * A support reply must never be lost because the message it quoted is gone.
 */
export interface TelegramReplyParameters {
  /** Required unless `ephemeral_message_id` is given. The id **in the target chat**. */
  readonly message_id?: number
  /** The chat the quoted message is in, when it is not the chat being sent to. */
  readonly chat_id?: number | string
  readonly ephemeral_message_id?: number
  readonly allow_sending_without_reply?: boolean
  /** Quotes part of the message rather than all of it; must match its text exactly. */
  readonly quote?: string
  readonly quote_parse_mode?: TelegramParseMode
  readonly quote_entities?: readonly unknown[]
  readonly quote_position?: number
  readonly checklist_task_id?: number
  readonly poll_option_id?: string
}

/**
 * An inbound update.
 *
 * Every member Telegram can send is listed even though the webhook asks for
 * two of them: `allowed_updates` is a runtime setting that somebody can widen
 * from a browser, and a type listing only today's subset would make the others
 * look impossible rather than merely unrequested.
 */
export interface TelegramUpdate {
  readonly update_id: number
  readonly message?: TelegramMessage
  readonly edited_message?: TelegramMessage
  readonly channel_post?: TelegramMessage
  readonly edited_channel_post?: TelegramMessage
  readonly business_connection?: unknown
  readonly business_message?: TelegramMessage
  readonly edited_business_message?: TelegramMessage
  readonly deleted_business_messages?: unknown
  readonly guest_message?: TelegramMessage
  readonly message_reaction?: unknown
  readonly message_reaction_count?: unknown
  readonly inline_query?: unknown
  readonly chosen_inline_result?: unknown
  readonly callback_query?: TelegramCallbackQuery
  readonly shipping_query?: unknown
  readonly pre_checkout_query?: unknown
  readonly purchased_paid_media?: unknown
  readonly poll?: unknown
  readonly poll_answer?: unknown
  readonly my_chat_member?: unknown
  readonly chat_member?: unknown
  readonly chat_join_request?: unknown
  readonly chat_boost?: unknown
  readonly removed_chat_boost?: unknown
  readonly managed_bot?: unknown
  readonly subscription?: unknown
  readonly stopped_message_generation?: unknown
}

/**
 * The update kinds `setWebhook` may be told to deliver.
 *
 * {@link MESSAGE} and {@link CALLBACK_QUERY} are requested, and no more.
 * Anything not listed in `allowed_updates` is dropped by Telegram before it
 * reaches us, which is the cheapest possible filter and the reason the webhook
 * cannot be flooded with reactions or polls.
 *
 * **The list is stored on Telegram's side, not ours**, and it is whatever the
 * last `setWebhook` said — so a bot whose webhook was registered by hand, or
 * before this deployment asked for callbacks, drops every inline key press
 * without a trace at either end. `SupportWebhookRegistrarService` reads the
 * live list back for exactly that reason.
 */
export enum TelegramUpdateType {
  MESSAGE = 'message',
  EDITED_MESSAGE = 'edited_message',
  CHANNEL_POST = 'channel_post',
  EDITED_CHANNEL_POST = 'edited_channel_post',
  MESSAGE_REACTION = 'message_reaction',
  MESSAGE_REACTION_COUNT = 'message_reaction_count',
  INLINE_QUERY = 'inline_query',
  CHOSEN_INLINE_RESULT = 'chosen_inline_result',
  CALLBACK_QUERY = 'callback_query',
  SHIPPING_QUERY = 'shipping_query',
  PRE_CHECKOUT_QUERY = 'pre_checkout_query',
  PURCHASED_PAID_MEDIA = 'purchased_paid_media',
  POLL = 'poll',
  POLL_ANSWER = 'poll_answer',
  MY_CHAT_MEMBER = 'my_chat_member',
  CHAT_MEMBER = 'chat_member',
  CHAT_JOIN_REQUEST = 'chat_join_request',
  CHAT_BOOST = 'chat_boost',
  REMOVED_CHAT_BOOST = 'removed_chat_boost'
}

/** `parse_mode` on any method that renders text. */
export enum TelegramParseMode {
  MARKDOWN_V2 = 'MarkdownV2',
  HTML = 'HTML',
  MARKDOWN = 'Markdown'
}

// --- Method parameters -----------------------------------------------------
//
// Each interface below is the complete parameter set Telegram documents for
// that method, not the subset currently passed. `chat_id` is typed
// `number | string` throughout because Telegram accepts either an id or an
// `@channelusername`.

export interface SendMessageParams {
  readonly chat_id: number | string
  readonly text: string
  readonly business_connection_id?: string
  readonly message_thread_id?: number
  readonly direct_messages_topic_id?: number
  readonly parse_mode?: TelegramParseMode
  readonly entities?: readonly unknown[]
  readonly link_preview_options?: TelegramLinkPreviewOptions
  readonly disable_notification?: boolean
  readonly protect_content?: boolean
  readonly allow_paid_broadcast?: boolean
  readonly message_effect_id?: string
  readonly suggested_post_parameters?: unknown
  readonly reply_parameters?: TelegramReplyParameters
  readonly reply_markup?: TelegramReplyMarkup
  readonly ephemeral_message_parameters?: unknown
}

export interface TelegramLinkPreviewOptions {
  readonly is_disabled?: boolean
  readonly url?: string
  readonly prefer_small_media?: boolean
  readonly prefer_large_media?: boolean
  readonly show_above_text?: boolean
}

export interface CopyMessageParams {
  readonly chat_id: number | string
  readonly from_chat_id: number | string
  readonly message_id: number
  readonly message_thread_id?: number
  readonly direct_messages_topic_id?: number
  readonly video_start_timestamp?: number
  readonly caption?: string
  readonly parse_mode?: TelegramParseMode
  readonly caption_entities?: readonly unknown[]
  readonly show_caption_above_media?: boolean
  readonly disable_notification?: boolean
  readonly protect_content?: boolean
  readonly allow_paid_broadcast?: boolean
  readonly suggested_post_parameters?: unknown
  readonly reply_parameters?: TelegramReplyParameters
  readonly reply_markup?: TelegramReplyMarkup
}

export interface CreateForumTopicParams {
  readonly chat_id: number | string
  /** 1–128 characters. Telegram rejects an empty or over-long name with a 400. */
  readonly name: string
  /** One of Telegram's six fixed colours, as an RGB integer. Anything else is a 400. */
  readonly icon_color?: TelegramTopicIconColor
  readonly icon_custom_emoji_id?: string
}

export interface EditForumTopicParams {
  readonly chat_id: number | string
  readonly message_thread_id: number
  readonly name?: string
  readonly icon_custom_emoji_id?: string
}

/** `closeForumTopic`, `reopenForumTopic` and `deleteForumTopic` all take exactly this. */
export interface ForumTopicParams {
  readonly chat_id: number | string
  readonly message_thread_id: number
}

/**
 * A media item as it is **sent**, not as it arrives.
 *
 * `media` takes a `file_id` — a file already on Telegram's servers — which is
 * what makes rebuilding an album free: the relay re-sends the very files it was
 * given, without downloading or uploading a byte. A file id is valid for the
 * bot that received it, which is the same bot sending it here.
 *
 * (The full field accepts an HTTP URL or an `attach://` upload as well. Neither
 * is used, and declaring them would suggest this relay ever holds a file.)
 */
export interface TelegramInputMediaPhoto {
  readonly type: 'photo'
  readonly media: string
  readonly caption?: string
  readonly show_caption_above_media?: boolean
  readonly parse_mode?: TelegramParseMode
  readonly caption_entities?: readonly TelegramMessageEntity[]
  readonly has_spoiler?: boolean
}

export interface TelegramInputMediaVideo {
  readonly type: 'video'
  readonly media: string
  readonly thumbnail?: string
  readonly cover?: string
  readonly start_timestamp?: number
  readonly caption?: string
  readonly show_caption_above_media?: boolean
  readonly parse_mode?: TelegramParseMode
  readonly caption_entities?: readonly TelegramMessageEntity[]
  readonly width?: number
  readonly height?: number
  readonly duration?: number
  readonly supports_streaming?: boolean
  readonly has_spoiler?: boolean
}

export interface TelegramInputMediaDocument {
  readonly type: 'document'
  readonly media: string
  readonly thumbnail?: string
  readonly caption?: string
  readonly parse_mode?: TelegramParseMode
  readonly caption_entities?: readonly TelegramMessageEntity[]
  readonly disable_content_type_detection?: boolean
}

export interface TelegramInputMediaAudio {
  readonly type: 'audio'
  readonly media: string
  readonly thumbnail?: string
  readonly caption?: string
  readonly parse_mode?: TelegramParseMode
  readonly caption_entities?: readonly TelegramMessageEntity[]
  readonly duration?: number
  readonly performer?: string
  readonly title?: string
}

export type TelegramInputMedia =
  | TelegramInputMediaPhoto
  | TelegramInputMediaVideo
  | TelegramInputMediaDocument
  | TelegramInputMediaAudio

export interface SendMediaGroupParams {
  readonly chat_id: number | string
  /**
   * 2–10 items. Photos and videos may be mixed; documents and audio may only be
   * grouped with their own kind — a rule Telegram enforces when the *user*
   * builds the album, so a group that arrives is already valid.
   */
  readonly media: readonly TelegramInputMedia[]
  readonly business_connection_id?: string
  readonly message_thread_id?: number
  readonly direct_messages_topic_id?: number
  readonly disable_notification?: boolean
  readonly protect_content?: boolean
  readonly allow_paid_broadcast?: boolean
  readonly message_effect_id?: string
  /** Unlike `copyMessages`, this method can make the whole album a reply. */
  readonly reply_parameters?: TelegramReplyParameters
}

export interface DeleteMessageParams {
  readonly chat_id: number | string
  readonly message_id: number
}

export interface SetWebhookParams {
  readonly url: string
  readonly certificate?: unknown
  readonly ip_address?: string
  /** 1–100, default 40. */
  readonly max_connections?: number
  readonly allowed_updates?: readonly TelegramUpdateType[]
  readonly drop_pending_updates?: boolean
  /** 1–256 chars, `A-Z a-z 0-9 _ -`. Echoed back in `X-Telegram-Bot-Api-Secret-Token`. */
  readonly secret_token?: string
}

/**
 * What `getWebhookInfo` answers: the webhook as **Telegram** holds it.
 *
 * Worth having because that record is the one that decides what is delivered,
 * and nothing in this deployment can see it otherwise. `allowed_updates` is
 * absent when the default is in force — which is every update type except
 * `chat_member`, `message_reaction` and `message_reaction_count` — so absent
 * means *wider* than our list, never narrower.
 */
export interface TelegramWebhookInfo {
  /** Empty string when no webhook is set at all. */
  readonly url: string
  readonly has_custom_certificate: boolean
  readonly pending_update_count: number
  readonly ip_address?: string
  readonly last_error_date?: number
  readonly last_error_message?: string
  readonly last_synchronization_error_date?: number
  readonly max_connections?: number
  /** Absent means Telegram's own default, not an empty list. */
  readonly allowed_updates?: readonly string[]
}

export interface AnswerCallbackQueryParams {
  readonly callback_query_id: string
  /** 0–200 characters, shown as a toast or, with `show_alert`, as a modal. */
  readonly text?: string
  readonly show_alert?: boolean
  readonly url?: string
  readonly cache_time?: number
}

/**
 * The only topic icon colours Telegram accepts, as documented for
 * `createForumTopic`. Passing any other integer is a 400.
 */
export enum TelegramTopicIconColor {
  BLUE = 0x6fb9f0,
  YELLOW = 0xffd67e,
  VIOLET = 0xcb86db,
  GREEN = 0x8eee98,
  ROSE = 0xff93b2,
  RED = 0xfb6f5f
}
