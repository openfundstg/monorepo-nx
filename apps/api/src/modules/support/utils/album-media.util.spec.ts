import type { TelegramMessage } from 'src/shared/interfaces'
import { albumReplyParameters, albumReplyTarget, buildAlbumMedia } from './album-media.util'

const photo = (id: string, over: Record<string, unknown> = {}): TelegramMessage =>
  ({
    message_id: 1,
    date: 1,
    chat: { id: 1, type: 'private' },
    photo: [
      { file_id: `${id}-small`, file_unique_id: 's', width: 90, height: 90 },
      { file_id: id, file_unique_id: 'l', width: 1280, height: 1280 }
    ],
    ...over
  }) as TelegramMessage

describe('buildAlbumMedia', () => {
  /** Sending the thumbnail back would silently degrade every screenshot. */
  it('takes the largest size of each photo', () => {
    const media = buildAlbumMedia([photo('a'), photo('b')])

    expect(media).toEqual([
      { type: 'photo', media: 'a' },
      { type: 'photo', media: 'b' }
    ])
  })

  /**
   * Telegram puts an album's caption on exactly one item, and which one is not
   * ours to assume — so it is found, not guessed at index zero.
   */
  it('keeps the caption on the item that carried it, with its formatting', () => {
    const entities = [{ type: 'bold', offset: 0, length: 4 }]
    const media = buildAlbumMedia([
      photo('a'),
      photo('b', { caption: 'чек про оплату', caption_entities: entities })
    ])

    expect(media?.[0]).not.toHaveProperty('caption')
    expect(media?.[1]).toMatchObject({ caption: 'чек про оплату', caption_entities: entities })
  })

  it('carries a spoiler across rather than unmasking it', () => {
    const media = buildAlbumMedia([photo('a'), photo('b', { caption: 'x', has_media_spoiler: true })])

    expect(media?.[1]).toMatchObject({ has_spoiler: true })
  })

  it.each([
    ['video', { video: { file_id: 'v', file_unique_id: 'u', width: 1, height: 1, duration: 1 } }],
    ['document', { document: { file_id: 'd', file_unique_id: 'u' } }],
    ['audio', { audio: { file_id: 'a', file_unique_id: 'u', duration: 1 } }]
  ])('describes a %s by its file id', (type, payload) => {
    const item = { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, ...payload }
    const media = buildAlbumMedia([item as TelegramMessage, item as TelegramMessage])

    expect(media?.[0]).toMatchObject({ type })
  })

  /**
   * The price of grouping is that each item must be described rather than moved
   * by id. Refusing the whole album — the caller then copies item by item — is
   * what keeps that price from being paid in somebody's lost attachment.
   */
  it('refuses an album holding media it cannot describe', () => {
    const sticker = {
      message_id: 2,
      date: 1,
      chat: { id: 1, type: 'private' },
      sticker: { file_id: 's' }
    } as unknown as TelegramMessage

    expect(buildAlbumMedia([photo('a'), sticker])).toBeNull()
  })

  it('refuses anything that is not between 2 and 10 items', () => {
    expect(buildAlbumMedia([photo('a')])).toBeNull()
    expect(buildAlbumMedia(Array.from({ length: 11 }, (_, i) => photo(`p${i}`)))).toBeNull()
  })
})

describe('albumReplyTarget', () => {
  /** Telegram marks the reply on the item the user replied with, not on all. */
  it('finds the reply wherever in the album it sits', () => {
    const items = [photo('a'), photo('b', { reply_to_message: { message_id: 42 } })]

    expect(albumReplyTarget(items)).toBe(42)
  })

  it('is undefined for an album that replies to nothing', () => {
    expect(albumReplyTarget([photo('a'), photo('b')])).toBeUndefined()
  })
})

describe('albumReplyParameters', () => {
  it('never lets a missing quote cost the delivery', () => {
    expect(albumReplyParameters(7)).toEqual({ message_id: 7, allow_sending_without_reply: true })
  })

  it('sends unquoted when the twin is unknown', () => {
    expect(albumReplyParameters(null)).toBeUndefined()
  })
})
