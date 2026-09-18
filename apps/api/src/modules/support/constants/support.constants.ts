import { TelegramTopicIconColor } from 'src/shared/interfaces'

/**
 * Everything the support module measures, counts or names.
 *
 * Grouped `as const` rather than scattered as literals because most of these
 * are limits Telegram enforces, and a magic `128` at a call site is
 * indistinguishable from an arbitrary one.
 */
export const SupportConfig = {
  /** Telegram's own limit on `createForumTopic.name`; a longer name is a 400. */
  TOPIC_NAME_MAX_LENGTH: 128,
  /** Colour a topic falls back to when its icon cannot be set. */
  TOPIC_ICON_COLOR: TelegramTopicIconColor.BLUE,
  /**
   * How long one update may be in flight before a retry is allowed to take it.
   *
   * Long enough to cover the three or four Bot API calls a first message makes
   * (create topic, intro, forward, greeting), short enough that a process
   * killed mid-update does not silence that user's next retry for an hour.
   */
  UPDATE_LOCK_TTL_MS: 60_000,
  /**
   * How long a successfully processed `update_id` is remembered.
   *
   * Telegram retries a failed delivery for up to roughly 24 hours, so anything
   * shorter reopens the duplicate it exists to prevent.
   */
  UPDATE_PROCESSED_TTL_S: 86_400,
  /** Held only across the create-topic round trip. */
  TOPIC_LOCK_TTL_MS: 15_000,
  /** Whole seconds. Bot API calls are small; a slow one is a failed one. */
  API_TIMEOUT_MS: 15_000,
  /**
   * How long to wait for the rest of an album after each item arrives.
   *
   * Telegram sends an album as separate updates and never says how many are
   * coming, so the end of one can only be inferred from a gap. Two seconds is
   * comfortably longer than the gap between items of a real album and short
   * enough that nobody reads it as the bot being slow; single messages are not
   * delayed at all, because only a message carrying `media_group_id` waits.
   */
  ALBUM_WINDOW_MS: 2_000,
  /**
   * How long a half-gathered album survives in Redis.
   *
   * Long enough to outlive a redelivery after a crash — the buffer is what a
   * retried update rebuilds the album from — and short enough that an album
   * nobody ever sent does not sit there for a day.
   */
  ALBUM_BUFFER_TTL_S: 600,
  /** Telegram's own cap on one album. More than this is not an album. */
  ALBUM_MAX_ITEMS: 10,
  /**
   * Attempts the flush job gets before an album is given up on.
   *
   * BullMQ defaults to one, which would make the buffer's whole "keep the items
   * until the send succeeds" design pointless: nothing would ever come back for
   * them. Three attempts with a growing gap covers the failure this is actually
   * for — a rate limit or a blip against Telegram — without hammering it.
   */
  ALBUM_FLUSH_ATTEMPTS: 3,
  ALBUM_FLUSH_BACKOFF_MS: 3_000,
  /**
   * Prefix on the `callback_data` of a language key: `lang:uk`.
   *
   * Namespaced rather than bare so a second kind of inline key added later
   * cannot be mistaken for a language — the payload is 64 bytes of free text
   * and nothing but this convention tells two features apart.
   */
  LANGUAGE_CALLBACK_PREFIX: 'lang:',
  /**
   * `callback_data` of the key that cancels a standing request for an amount.
   *
   * Namespaced like the language prefix and for the same reason: the payload is
   * 64 bytes of free text, and only this convention keeps two features' keys
   * apart. It carries no id — the request being cancelled is always the one
   * belonging to whoever pressed the key, and a request id in a payload a
   * client can edit would be a request id somebody else could cancel.
   */
  FIAT_WATCH_OFF_CALLBACK: 'fiatwatch:off',
  /**
   * The two card-sale keys, each followed by Transacto's numeric order id.
   *
   * Namespaced like the language prefix, and short on purpose: `callback_data`
   * is capped at 64 bytes, and an order id is the whole payload — the sale is
   * looked up from it rather than carried, so the presser cannot name a sale
   * and the key cannot be edited into one belonging to somebody else.
   */
  CARD_SALE_CONFIRM_PREFIX: 'csale:ok:',
  CARD_SALE_DENY_PREFIX: 'csale:no:'
} as const

/**
 * Environment this module reads. Documented here because there is no
 * `.env.example` in the repository and `src/environments/index.ts` is an
 * untyped passthrough over `process.env`.
 *
 * | Variable | Required | Meaning |
 * |---|---|---|
 * | `TELEGRAM_BOT_TOKEN` | yes | **The Mini App's bot.** `TmaAuthService` derives its `initData` key from it — putting another bot's token here logs every user out. |
 * | `TELEGRAM_SUPPORT_BOT_TOKEN` | no | The support bot's own token, when it is a different bot. Unset means "the same bot as the Mini App". |
 * | `TELEGRAM_SUPPORT_GROUP_ID` | yes | Forum supergroup id, negative (`-100…`). Without it the module boots inert. |
 * | `TELEGRAM_SUPPORT_WEBHOOK_SECRET` | yes | Shared secret echoed in `X-Telegram-Bot-Api-Secret-Token`. |
 * | `TELEGRAM_SUPPORT_WEBHOOK_URL` | no | Full public URL of the endpoint. **Set it in production only** — see `SupportWebhookRegistrarService`. |
 * | `TELEGRAM_BOT_USERNAME` | no | The Mini App's bot handle, used to build the "open the app" key on a notification. Unset drops that key rather than the message. |
 *
 * The path the URL must end in is {@link SUPPORT_WEBHOOK_PATH}, prefixed by the
 * global `api` prefix set in `main.ts`.
 */
/**
 * The icon each state shows, as one of Telegram's own topic emoji.
 *
 * **The state belongs in the icon, not in the title.** A marker glued to the
 * front of the name is drawn beside Telegram's own topic icon, so every row in
 * the list carried two icons and read as clutter — on mobile especially. A
 * topic already has a slot for exactly this, and `editForumTopic` can change it.
 *
 * The ids come from `getForumTopicIconStickers`, the fixed set Telegram allows
 * for topic icons — not arbitrary custom emoji, and not Premium-gated. They are
 * stable system stickers; if one is ever rejected, {@link SupportTopicService}
 * falls back to creating the topic without an icon rather than losing the
 * message behind it.
 */
export const SUPPORT_TOPIC_ICON = {
  /** 💬 — a live conversation. Deliberately not ❗️: an answered but still open
   *  thread is not an alarm, and the two states do not distinguish them. */
  OPEN: '5417910000005203993',
  /** ✅ — dealt with. Telegram draws its own padlock beside it. */
  CLOSED: '5237690000009300968'
} as const

export const SUPPORT_WEBHOOK_PATH = 'support/telegram'

/**
 * Telegram's own host. Hardcoded deliberately: it is a vendor endpoint, the
 * same for every deployment, and not something an operator may point elsewhere
 * — the bot token in the path is only valid against this host. Same reasoning
 * as `TELEGRAM_LINK_BASE` in the referral service.
 */
export const TELEGRAM_API_BASE_URL = 'https://api.telegram.org'
