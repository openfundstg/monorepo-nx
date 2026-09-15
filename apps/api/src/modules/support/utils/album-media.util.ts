import { SupportConfig } from 'src/modules/support/constants/support.constants'
import type {
  TelegramInputMedia,
  TelegramMessage,
  TelegramReplyParameters
} from 'src/shared/interfaces'

/**
 * One album item, as it must be re-sent.
 *
 * Returns `null` for anything that cannot go in an album — a text message, a
 * sticker, a media type invented after this was written. The caller falls back
 * to copying the items one by one, so an unknown type costs the grouping and
 * nothing else.
 *
 * The caption is deliberately **not** taken from the item itself: Telegram puts
 * an album's caption on exactly one of its items, and which one is not ours to
 * assume. {@link buildAlbumMedia} places it.
 */
const toInputMedia = (message: TelegramMessage): TelegramInputMedia | null => {
  // The last size is the largest — sending a thumbnail back would silently
  // degrade every screenshot a user sends.
  const photo = message.photo?.at(-1)
  if (photo) return { type: 'photo', media: photo.file_id }

  if (message.video) return { type: 'video', media: message.video.file_id }
  if (message.document) return { type: 'document', media: message.document.file_id }
  if (message.audio) return { type: 'audio', media: message.audio.file_id }

  return null
}

/**
 * Rebuilds an album from the messages it arrived as, or `null` if it cannot be
 * rebuilt faithfully.
 *
 * This is the one place in the relay that looks inside a message, and it is
 * worth being honest about the cost: everywhere else content travels by id and
 * therefore supports message types nobody has heard of yet. An album cannot —
 * `sendMediaGroup` names each item — so the price of keeping three screenshots
 * grouped is a mapping that has to be taught new media types. Refusing loudly
 * (`null`) rather than dropping the unmapped item is what keeps that price from
 * being paid in somebody's lost attachment.
 */
export const buildAlbumMedia = (messages: readonly TelegramMessage[]): TelegramInputMedia[] | null => {
  if (messages.length < 2 || messages.length > SupportConfig.ALBUM_MAX_ITEMS) return null

  const media = messages.map(toInputMedia)
  if (media.some((item) => item === null)) return null

  const captioned = messages.findIndex((message) => Boolean(message.caption))

  return (media as TelegramInputMedia[]).map((item, index) =>
    index === captioned
      ? {
          ...item,
          caption: messages[index].caption,
          caption_entities: messages[index].caption_entities,
          ...(messages[index].show_caption_above_media
            ? { show_caption_above_media: true }
            : {}),
          ...(messages[index].has_media_spoiler ? { has_spoiler: true } : {})
        }
      : item
  )
}

/**
 * The message an album replies to, if any of its items says so.
 *
 * Telegram marks the reply on the item the user actually replied with — in
 * practice the first — rather than on all of them, so the whole group is
 * scanned instead of assuming a position.
 */
export const albumReplyTarget = (messages: readonly TelegramMessage[]): number | undefined =>
  messages.find((message) => message.reply_to_message)?.reply_to_message?.message_id

/** Applies a resolved reply to the whole album, or leaves it unquoted. */
export const albumReplyParameters = (
  messageId: number | null
): TelegramReplyParameters | undefined =>
  messageId === null ? undefined : { message_id: messageId, allow_sending_without_reply: true }
