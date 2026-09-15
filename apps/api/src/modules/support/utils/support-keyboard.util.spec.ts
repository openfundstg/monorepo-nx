import { SupportLocale } from 'src/shared/constants'
import { SupportButton } from 'src/modules/support/enums'
import {
  buildLanguageKeyboard,
  buildMainKeyboard,
  buttonOf,
  localeFromCallbackData
} from './support-keyboard.util'

describe('buttonOf', () => {
  it('reads a key in the language it was drawn in', () => {
    expect(buttonOf('💰 Баланс')).toBe(SupportButton.BALANCE)
    expect(buttonOf('📖 Guide')).toBe(SupportButton.GUIDE)
    expect(buttonOf('🌐 Язык')).toBe(SupportButton.LANGUAGE)
  })

  /**
   * Switching language does not relabel a keyboard already on screen, so a user
   * can be looking at English keys while their stored locale says Ukrainian. A
   * lookup limited to the current locale would forward the tap to an operator.
   */
  it('reads every label of every language, not just one', () => {
    const labels = ['📖 Гайд', '📖 Guide', '💬 Поддержка', '🌐 Language']

    expect(labels.every((label) => buttonOf(label) !== undefined)).toBe(true)
  })

  it('is not fooled by ordinary text that mentions a key', () => {
    expect(buttonOf('де мій баланс?')).toBeUndefined()
    expect(buttonOf('Balance')).toBeUndefined()
  })

  it('ignores a message with no text', () => {
    expect(buttonOf(undefined)).toBeUndefined()
  })
})

describe('buildMainKeyboard', () => {
  it('labels every key in the requested language', () => {
    const keyboard = buildMainKeyboard(SupportLocale.EN)
    const labels = keyboard.keyboard.flat().map((key) => key.text)

    expect(labels).toEqual(['📖 Guide', '💰 Balance', '💬 Support', '🌐 Language'])
  })

  it('stays persistent and resized, or Telegram hides it behind an icon', () => {
    expect(buildMainKeyboard(SupportLocale.UK)).toMatchObject({
      is_persistent: true,
      resize_keyboard: true
    })
  })

})

describe('language keys', () => {
  /** Somebody who cannot read the current language must still find their own. */
  it('names each language in itself', () => {
    const labels = buildLanguageKeyboard().inline_keyboard.flat().map((key) => key.text)

    expect(labels).toEqual(['🇺🇦 Українська', '🇷🇺 Русский', '🇬🇧 English'])
  })

  it('round-trips its own callback data', () => {
    const keys = buildLanguageKeyboard().inline_keyboard.flat()

    expect(keys.map((key) => localeFromCallbackData(key.callback_data))).toEqual([
      SupportLocale.UK,
      SupportLocale.RU,
      SupportLocale.EN
    ])
  })

  it.each([['lang:de'], ['other:uk'], ['uk'], [undefined]])(
    'refuses payload %p rather than guessing a language',
    (data?: string) => {
      expect(localeFromCallbackData(data)).toBeUndefined()
    }
  )
})
