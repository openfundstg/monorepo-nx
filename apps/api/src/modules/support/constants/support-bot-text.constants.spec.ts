import { BankProvider, OFFICIAL_CHANNEL_URL, SALE_ENABLED_BANKS } from '@transacto/contracts'
import { SupportLocale } from 'src/shared/constants'
import { SupportButton } from 'src/modules/support/enums'
import {
  ALL_DICTIONARIES,
  BANK_NAME,
  BRAND,
  SupportUserText,
  dictionaryOf,
  resolveSupportLocale,
  supportBalanceCard,
  supportGuideText,
  type SupportDictionary
} from './support-bot-text.constants'

describe('resolveSupportLocale', () => {
  /**
   * Telegram reports the *client's* language, so a Ukrainian with an English
   * phone is told they are English on every message. A preference that lost to
   * that would be forgotten the moment it was made.
   */
  it('lets a hand-picked language beat what the client reports', () => {
    expect(resolveSupportLocale(SupportLocale.UK, 'en-GB')).toBe(SupportLocale.UK)
  })

  it.each([
    ['uk', SupportLocale.UK],
    ['ru', SupportLocale.RU],
    ['uk-UA', SupportLocale.UK],
    ['en-GB', SupportLocale.EN]
  ])('reads %s off the client tag as %s', (tag, expected) => {
    expect(resolveSupportLocale(null, tag)).toBe(expected)
  })

  it.each([['de'], ['pl'], [undefined], ['']])('falls back to English for %p', (tag?: string) => {
    expect(resolveSupportLocale(null, tag)).toBe(SupportLocale.EN)
  })
})

describe('dictionaries', () => {
  /**
   * A missing key would not fail to compile — `Record` is satisfied by the
   * object literal, and a language added later is where a gap actually appears.
   * A blank message to a user is worse than an English one.
   */
  it('translate every sentence and every key into every language', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      for (const key of Object.values(SupportUserText)) expect(dictionary.text[key]).toBeTruthy()
      for (const button of Object.values(SupportButton))
        expect(dictionary.buttons[button]).toBeTruthy()
    }
  })

  /**
   * Users of this bot must never see the operator-side name. The bot greets
   * every new user by name, so a stale brand here is the most visible string
   * in the product — and it is spread across three dictionaries, which is
   * exactly where a rename gets missed.
   */
  it('name no brand but the current one', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      const rendered = everyLineOf(dictionary)

      for (const line of rendered) expect(line).not.toMatch(/transacto/i)
    }
  })

  /**
   * The channel is the one address in these dictionaries a user can act on, and
   * it is the first thing `/start` offers them.
   */
  it('point every greeting at the official channel', () => {
    for (const dictionary of ALL_DICTIONARIES) {
      expect(dictionary.text[SupportUserText.GREETING]).toContain(OFFICIAL_CHANNEL_URL)
    }
  })

  /**
   * Every string here is sent with `parse_mode: HTML`, which is what lets the
   * greeting carry a link — and what turns a stray `&` or `<` in somebody's
   * sentence into a message Telegram refuses to deliver at all.
   *
   * Only the three tags these dictionaries actually use are allowed, so a
   * fourth is a decision rather than an accident.
   */
  it('keep every line safe to send as HTML', () => {
    const allowed = /<\/?(b|i)>|<a href="[^"]*">|<\/a>/g

    for (const dictionary of ALL_DICTIONARIES) {
      const rendered = everyLineOf(dictionary)

      for (const line of rendered) {
        expect(line.replace(allowed, '')).not.toMatch(/[<>&]/)
      }
    }
  })

  it('greets users by the brand rather than by nothing at all', () => {
    expect(dictionaryOf(SupportLocale.EN).text[SupportUserText.GREETING]).toContain(BRAND)
  })

  it('give every language its own labels rather than sharing one set', () => {
    const support = ALL_DICTIONARIES.map((d) => d.buttons[SupportButton.SUPPORT])

    expect(new Set(support).size).toBe(ALL_DICTIONARIES.length)
  })
})

/**
 * Every sentence a dictionary can produce, for the sweeps that check all of
 * them at once.
 *
 * A helper rather than a list written out per sweep, because the list is what
 * goes stale: `fiatAmountsAvailable` and `inlineButtons` were added and neither
 * sweep noticed, so a brand or an unescaped `&` in the newest strings in the
 * file was the one thing these tests could not see.
 *
 * Every interpolated figure is supplied in full. The card used to be called
 * with three of its five fields, which passed only because the missing ones
 * rendered as `NaN` — specs are not covered by `tsconfig.app.json`, so nothing
 * was going to say so.
 */
const everyLineOf = (dictionary: SupportDictionary): string[] => [
  ...Object.values(dictionary.text),
  ...Object.values(dictionary.buttons),
  ...Object.values(dictionary.inlineButtons),
  dictionary.guide({ minUsdt: 10, remainderUah: 300, banks: 'PrivatBank', payWindowMinutes: 15 }),
  dictionary.balanceCard({
    available: 100,
    frozen: 100,
    referral: 100,
    turnover: 100_000,
    rates: { buy: 4_577, sell: 4_692 }
  }),
  dictionary.balanceCard({
    available: 100,
    frozen: 0,
    referral: 0,
    turnover: 0,
    rates: null
  }),
  dictionary.fiatAmountsAvailable({
    amountsUah: [100_000, 250_000],
    minAmountUah: 50_000,
    maxAmountUah: 300_000,
    once: false
  }),
  dictionary.fiatAmountsAvailable({
    amountsUah: [100_000],
    minAmountUah: 50_000,
    maxAmountUah: 300_000,
    once: true
  })
]

describe('balance card', () => {
  const card = (over: Partial<Parameters<typeof supportBalanceCard>[1]> = {}) =>
    supportBalanceCard(SupportLocale.UK, {
      available: 123_456,
      frozen: 1_000,
      referral: 120,
      turnover: 4_500_000,
      // A real spread: the market at ₴46.00, less 0.5% to buy and plus 2% to
      // sell. Written as the finished figures the service derives, because the
      // card is never handed a market rate.
      rates: { buy: 4_577, sell: 4_692 },
      ...over
    })

  it('formats cents as a grouped decimal, matching the Mini App', () => {
    // A non-breaking space, which is what `uk-UA` groups thousands with — the
    // same character the Mini App's formatter emits, and invisible in a diff.
    expect(card()).toContain('1\u00a0234,56 USDT')
    expect(card()).toContain('10,00 USDT')
    expect(card()).toContain('1,20 USDT')
  })

  /** Kopecks, not cents — the one figure on this card in a different unit. */
  it('prints the lifetime turnover in hryvnia', () => {
    expect(card({ turnover: 4_500_000 })).toContain('45\u00a0000,00 грн')
  })

  it('prints both prices, not one', () => {
    const both = card()

    expect(both).toContain('45,77 грн')
    expect(both).toContain('46,92 грн')
  })

  /**
   * The gap between the two lines above it, through the contract's own helpers
   * — the same ones the Mini App's dashboard banner uses, so the bot and the
   * screen a tap later cannot report two different profits.
   */
  it('states what the round trip earns, in hryvnia and percent', () => {
    const both = card()

    // 4692 − 4577 = 115 kopecks, and 4692/4577 − 1 = 2.51%.
    expect(both).toContain('1,15 грн')
    expect(both).toContain('2,5%')
  })

  /**
   * A spread that is not positive is not a smaller promise, it is a different
   * sentence — and this card is not the place to write it. The dashboard drops
   * its banner on the same condition.
   */
  it('says nothing about profit when there is none to state', () => {
    const inverted = card({ rates: { buy: 4_692, sell: 4_692 } })

    expect(inverted).toContain('46,92 грн')
    expect(inverted).not.toContain('профіт')
  })

  /**
   * The prices are the only figures here that come from outside, and the only
   * ones allowed to be missing: a balance is still worth showing without them.
   */
  it('drops the price lines rather than the card when the market is unreachable', () => {
    const withoutRates = card({ rates: null })

    expect(withoutRates).toContain('1\u00a0234,56 USDT')
    expect(withoutRates).not.toContain('за 1 USDT')
    expect(withoutRates).not.toContain('профіт')
  })

  /** "У роботі: 0,00" is noise on a card whose whole job is one number. */
  it('leaves out the pots that are empty', () => {
    const lean = card({ available: 500, frozen: 0, referral: 0 })

    expect(lean).toContain('5,00 USDT')
    expect(lean).not.toContain('У роботі')
    expect(lean).not.toContain('Реферальні')
  })
})

describe('guide', () => {
  /** The floor comes from contracts, so the bot cannot quote a different one. */
  it('names the deposit minimum the rest of the product enforces', () => {
    expect(supportGuideText(SupportLocale.EN)).toContain('10 USDT')
  })

  /**
   * A sale can end two ways and the user picks which when they create
   * it. A guide that named only the refund — as this one did — describes a
   * product where the default behaviour does not exist.
   */
  it.each([
    [SupportLocale.UK, 'Дочекатися повної суми', 'Повернути залишок на баланс'],
    [SupportLocale.RU, 'Дождаться полной суммы', 'Вернуть остаток на баланс'],
    [SupportLocale.EN, 'Wait for the full amount', 'Return the remainder to your balance']
  ])('explains both remainder policies in %s', (locale, wait, refund) => {
    const guide = supportGuideText(locale)

    expect(guide).toContain(wait)
    expect(guide).toContain(refund)
  })

  /**
   * The hryvnia route existed for weeks before the guide mentioned it — a user
   * asking the bot how to top up was told to buy USDT somewhere else and send
   * it, while the app offered to sell them some.
   */
  it.each([
    [SupportLocale.UK, 'Гривнею'],
    [SupportLocale.RU, 'Гривной'],
    [SupportLocale.EN, 'In hryvnia']
  ])('offers the hryvnia route as well as the crypto one in %s', (locale, phrase) => {
    const guide = supportGuideText(locale)

    expect(guide).toContain(phrase)
    expect(guide).toContain('TRC-20')
  })

  /**
   * **The banks come from the list the create form filters on.** This one went
   * wrong the expensive way round: the guide named monobank for months after
   * sales on it were switched off, so the bot invited users to a bank the form
   * would not let them pick, and never mentioned NovaPay at all.
   */
  it('names exactly the banks a sale can be created on', () => {
    const guide = supportGuideText(SupportLocale.UK)

    for (const bank of SALE_ENABLED_BANKS) expect(guide).toContain(BANK_NAME[bank])

    for (const bank of Object.values(BankProvider))
      if (!SALE_ENABLED_BANKS.includes(bank))
        expect(guide).not.toContain(BANK_NAME[bank])
  })

  /** The threshold is deployment-configurable; a figure written here would drift. */
  it('names the same remainder threshold the server settles against', () => {
    expect(supportGuideText(SupportLocale.UK)).toContain('300 грн')
  })

  it('is written in the requested language', () => {
    expect(supportGuideText(SupportLocale.RU)).toContain('Как работает')
    expect(
      dictionaryOf(SupportLocale.UK).guide({
        minUsdt: 10,
        remainderUah: 300,
        banks: 'PrivatBank',
        payWindowMinutes: 15
      })
    ).toContain('Як працює')
  })
})
