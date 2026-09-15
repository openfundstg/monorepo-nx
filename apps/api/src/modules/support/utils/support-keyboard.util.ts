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
