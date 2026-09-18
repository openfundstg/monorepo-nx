import { SupportLocale } from 'src/shared/constants'
import { SupportButton, SupportInlineButton } from 'src/modules/support/enums'
import { SupportConfig } from 'src/modules/support/constants/support.constants'
import {
  ALL_DICTIONARIES,
  dictionaryOf,
  supportInlineButtonLabel as inlineLabel
} from 'src/modules/support/constants/support-bot-text.constants'
import type {
  TelegramInlineKeyboardMarkup,
  TelegramReplyKeyboardMarkup
} from 'src/shared/interfaces'

/**
 * Every label of every language, mapped back to the key it belongs to.
 *
 * Built across all three dictionaries rather than the current one, because the
 * keyboard on a user's screen is whichever language it was drawn in — switching
 * language does not retroactively relabel a keyboard already sent, and a user
 * can be looking at English keys while their stored locale says Ukrainian. A
 * lookup limited to the current locale would forward their next tap to an
 * operator as a question reading "Balance".
 */
const LABEL_TO_BUTTON: ReadonlyMap<string, SupportButton> = new Map(
  ALL_DICTIONARIES.flatMap((dictionary) =>
    Object.entries(dictionary.buttons).map(
      ([button, label]) => [label, button as SupportButton] as const
    )
  )
)

/** The key a message is, if it is one at all. */
export const buttonOf = (text: string | undefined): SupportButton | undefined =>
  text ? LABEL_TO_BUTTON.get(text.trim()) : undefined

/**
 * The persistent keyboard, in the user's language.
 *
 * `is_persistent` keeps it on screen instead of collapsing behind the keyboard
 * icon, and `resize_keyboard` stops Telegram rendering four comically tall keys.
 */
export const buildMainKeyboard = (locale: SupportLocale): TelegramReplyKeyboardMarkup => {
  const labels = dictionaryOf(locale).buttons

  return {
    keyboard: [
      [{ text: labels[SupportButton.GUIDE] }, { text: labels[SupportButton.BALANCE] }],
      [{ text: labels[SupportButton.SUPPORT] }, { text: labels[SupportButton.LANGUAGE] }]
    ],
    is_persistent: true,
    resize_keyboard: true
  }
}

/**
 * The three languages, each written in itself.
 *
 * Never translated into the *current* language, which would be the one thing a
 * language menu must not do: somebody who cannot read the current language has
 * to be able to find their own in the list.
 */
export const buildLanguageKeyboard = (): TelegramInlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: '🇺🇦 Українська', callback_data: languageCallbackData(SupportLocale.UK) },
      { text: '🇷🇺 Русский', callback_data: languageCallbackData(SupportLocale.RU) },
      { text: '🇬🇧 English', callback_data: languageCallbackData(SupportLocale.EN) }
    ]
  ]
})

const languageCallbackData = (locale: SupportLocale): string =>
  `${SupportConfig.LANGUAGE_CALLBACK_PREFIX}${locale}`

/**
 * The language behind a pressed key, or `undefined` for a payload this feature
 * did not send — an old keyboard, another feature's key, or a forgery.
 */
export const localeFromCallbackData = (data: string | undefined): SupportLocale | undefined => {
  if (!data?.startsWith(SupportConfig.LANGUAGE_CALLBACK_PREFIX)) return undefined

  const value = data.slice(SupportConfig.LANGUAGE_CALLBACK_PREFIX.length)

  return Object.values(SupportLocale).find((locale) => locale === value)
}

/**
 * The keys under a "your amount has appeared" message.
 *
 * Two decisions are visible in the signature. `appUrl` is optional because the
 * message must survive a deployment with no `TELEGRAM_BOT_USERNAME` — a missing
 * shortcut is a worse message, an unsent one is no message at all. And
 * `canUnsubscribe` is passed rather than derived from the mode here, because a
 * one-off request is already gone by the time this is drawn: a key offering to
 * cancel it could only ever answer "there was nothing to cancel".
 *
 * `undefined` rather than an empty markup when there is nothing to draw —
 * Telegram renders `{ inline_keyboard: [] }` as a stray empty row.
 */
export const buildFiatWatchKeyboard = (
  locale: SupportLocale,
  options: { readonly canUnsubscribe: boolean; readonly appUrl: string | null }
): TelegramInlineKeyboardMarkup | undefined => {
  const keys = [
    ...(options.appUrl === null
      ? []
      : [
          {
            text: inlineLabel(locale, SupportInlineButton.OPEN_MINI_APP),
            url: options.appUrl
          }
        ]),
    ...(options.canUnsubscribe
      ? [
          {
            text: inlineLabel(locale, SupportInlineButton.FIAT_WATCH_OFF),
            callback_data: SupportConfig.FIAT_WATCH_OFF_CALLBACK
          }
        ]
      : [])
  ]

  return keys.length === 0 ? undefined : { inline_keyboard: [keys] }
}

/** Whether a pressed key is the one that cancels a standing request. */
export const isFiatWatchOffCallback = (data: string | undefined): boolean =>
  data === SupportConfig.FIAT_WATCH_OFF_CALLBACK

/**
 * The keys under a card sale's question.
 *
 * Each carries only Transacto's numeric order id, which keeps the payload far
 * inside Telegram's 64-byte cap and — more to the point — means the presser
 * cannot name a sale. The sale is looked up from the order, and ownership is
 * proven server-side regardless.
 *
 * `canDeny` is false once the order is already disputed: a key offering to deny
 * it could only ever answer "that is where it already is", exactly as the
 * unsubscribe key is withheld from a one-off request.
 *
 * `appUrl` is optional because the message must survive a deployment with no
 * `TELEGRAM_BOT_USERNAME` — a missing shortcut is a worse message, an unsent
 * one is no message at all.
 */
export const buildCardOrderKeyboard = (
  locale: SupportLocale,
  options: {
    readonly orderId: number
    readonly canDeny: boolean
    readonly appUrl: string | null
  }
): TelegramInlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      {
        text: inlineLabel(locale, SupportInlineButton.CARD_SALE_CONFIRM),
        callback_data: `${SupportConfig.CARD_SALE_CONFIRM_PREFIX}${options.orderId}`
      },
      ...(options.canDeny
        ? [
            {
              text: inlineLabel(locale, SupportInlineButton.CARD_SALE_DENY),
              callback_data: `${SupportConfig.CARD_SALE_DENY_PREFIX}${options.orderId}`
            }
          ]
        : [])
    ],
    ...(options.appUrl === null
      ? []
      : [[{ text: inlineLabel(locale, SupportInlineButton.OPEN_SALE), url: options.appUrl }]])
  ]
})

/**
 * The order id behind a pressed key, or `null` for a payload this feature did
 * not send — an old keyboard, another feature's key, or a forgery.
 *
 * Parsed strictly. `Number('')` is `0`, and `Number('12abc')` is `NaN`, so an
 * emptied or edited payload must not read as order zero — the same rule the
 * panel table parser keeps, for the same reason.
 */
const orderIdAfter = (prefix: string, data: string | undefined): number | null => {
  if (!data?.startsWith(prefix)) return null

  const digits = data.slice(prefix.length)
  if (!/^[0-9]+$/.test(digits)) return null

  const orderId = Number(digits)

  return Number.isSafeInteger(orderId) && orderId > 0 ? orderId : null
}

/** The order a "money arrived" key answers for, if that is what was pressed. */
export const cardSaleConfirmOrderId = (data: string | undefined): number | null =>
  orderIdAfter(SupportConfig.CARD_SALE_CONFIRM_PREFIX, data)

/** …and the same for "nothing arrived". */
export const cardSaleDenyOrderId = (data: string | undefined): number | null =>
  orderIdAfter(SupportConfig.CARD_SALE_DENY_PREFIX, data)

/** Whether a pressed key belongs to a card sale at all. */
export const isCardSaleCallback = (data: string | undefined): boolean =>
  cardSaleConfirmOrderId(data) !== null || cardSaleDenyOrderId(data) !== null
