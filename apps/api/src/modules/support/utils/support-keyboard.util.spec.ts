import { SupportLocale } from 'src/shared/constants'
import { SupportButton } from 'src/modules/support/enums'
import {
  buildCardOrderKeyboard,
  buildLanguageKeyboard,
  buildMainKeyboard,
  buttonOf,
  cardSaleConfirmOrderId,
  cardSaleDenyOrderId,
  isCardSaleCallback,
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

describe('card sale keys', () => {
  const ORDER_ID = 1_234_567

  describe('buildCardOrderKeyboard', () => {
    const keyboard = (canDeny: boolean, appUrl: string | null = null) =>
      buildCardOrderKeyboard(SupportLocale.UK, { orderId: ORDER_ID, canDeny, appUrl })

    it('carries the order id and nothing else', () => {
      const [[confirm, deny]] = keyboard(true).inline_keyboard

      expect(confirm.callback_data).toBe(`csale:ok:${ORDER_ID}`)
      expect(deny?.callback_data).toBe(`csale:no:${ORDER_ID}`)
    })

    /**
     * Telegram caps `callback_data` at 64 bytes, and the reason the payload is
     * this thin is not only the cap: a sale id in there would be a sale a
     * client could edit the key into naming.
     */
    it('stays well inside Telegram’s payload limit', () => {
      for (const row of keyboard(true).inline_keyboard) {
        for (const key of row) {
          expect(Buffer.byteLength(key.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64)
        }
      }
    })

    /**
     * A key offering to deny an order already in dispute could only ever answer
     * "that is where it already is" — the same reason the unsubscribe key is
     * withheld from a one-off request.
     */
    it('drops the deny key once the order is already disputed', () => {
      const [row] = keyboard(false).inline_keyboard

      expect(row).toHaveLength(1)
    })

    /** A missing shortcut is a worse message; an unsent one is no message. */
    it('drops the app link rather than the message when there is no bot username', () => {
      expect(keyboard(true, null).inline_keyboard).toHaveLength(1)
      expect(keyboard(true, 'https://t.me/bot').inline_keyboard).toHaveLength(2)
    })
  })

  describe('reading a pressed key', () => {
    it('reads the order back out', () => {
      expect(cardSaleConfirmOrderId(`csale:ok:${ORDER_ID}`)).toBe(ORDER_ID)
      expect(cardSaleDenyOrderId(`csale:no:${ORDER_ID}`)).toBe(ORDER_ID)
    })

    it('does not confuse the two keys', () => {
      expect(cardSaleConfirmOrderId(`csale:no:${ORDER_ID}`)).toBeNull()
      expect(cardSaleDenyOrderId(`csale:ok:${ORDER_ID}`)).toBeNull()
    })

    /**
     * `Number('')` is `0` and `Number('12abc')` is `NaN`. An emptied or edited
     * payload must not read as order zero — the same rule the panel table
     * parser keeps, for the same reason.
     */
    it.each(['csale:ok:', 'csale:ok:0', 'csale:ok:-1', 'csale:ok:12abc', 'csale:ok: 12', 'lang:uk', '', undefined])(
      'refuses %p rather than inventing an order',
      (data) => {
        expect(cardSaleConfirmOrderId(data)).toBeNull()
        expect(isCardSaleCallback(data)).toBe(false)
      }
    )

    it('recognises either key as a card sale key', () => {
      expect(isCardSaleCallback(`csale:ok:${ORDER_ID}`)).toBe(true)
      expect(isCardSaleCallback(`csale:no:${ORDER_ID}`)).toBe(true)
    })
  })
})
