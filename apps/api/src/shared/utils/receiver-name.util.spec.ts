import { resolveReceiverName } from './receiver-name.util'

const TELEGRAM_ID = 885_140

describe('resolveReceiverName', () => {
  /**
   * The bank is naming the account it will pay into, so it cannot disagree with
   * itself. Nothing the user typed outranks that.
   */
  it('prefers the name the bank reported', () => {
    expect(
      resolveReceiverName({
        bankOwnerName: 'Петренко І.',
        firstName: 'Roman',
        lastName: 'Y',
        username: 'roman',
        telegramId: TELEGRAM_ID,
      }),
    ).toBe('Петренко І.')
  })

  /**
   * The bank's answer is left exactly as it came. Reformatting it to match the
   * Telegram-derived ones would make the two indistinguishable, and only one of
   * them has been checked by anybody.
   */
  it('does not reformat what the bank said', () => {
    expect(
      resolveReceiverName({ bankOwnerName: 'ПЕТРЕНКО І.', telegramId: TELEGRAM_ID }),
    ).toBe('ПЕТРЕНКО І.')
  })

  /** Monobank and PUMB disclose no owner, so the profile is all there is. */
  it('falls back to the Telegram profile name', () => {
    expect(
      resolveReceiverName({
        bankOwnerName: null,
        firstName: 'Роман',
        lastName: 'Петренко',
        telegramId: TELEGRAM_ID,
      }),
    ).toBe('Роман Петренко')
  })

  it('copes with only one half of the profile name', () => {
    expect(resolveReceiverName({ firstName: 'Роман', telegramId: TELEGRAM_ID })).toBe('Роман')
    expect(resolveReceiverName({ lastName: 'Петренко', telegramId: TELEGRAM_ID })).toBe('Петренко')
  })

  /**
   * `TmaUser` defaults both name fields to an empty string, so "absent" arrives
   * as `''` far more often than as `null` — joining them unguarded produced a
   * lone space, which is a name of sorts as far as `if (name)` is concerned.
   */
  it.each([
    ['empty strings', { firstName: '', lastName: '' }],
    ['whitespace', { firstName: '  ', lastName: '\t' }],
    ['nulls', { firstName: null, lastName: null }],
  ])('treats %s as no name at all', (_label, profile) => {
    expect(resolveReceiverName({ ...profile, username: 'roman', telegramId: TELEGRAM_ID })).toBe(
      'roman',
    )
  })

  it('collapses stray whitespace inside a name', () => {
    expect(
      resolveReceiverName({ firstName: '  Роман ', lastName: ' Петренко  ', telegramId: TELEGRAM_ID }),
    ).toBe('Роман Петренко')
  })

  it('falls back to the username when there is no name set', () => {
    expect(resolveReceiverName({ username: 'roman', telegramId: TELEGRAM_ID })).toBe('roman')
  })

  /**
   * The API requires the field. Refusing to create a terminal because a user
   * set no Telegram name would cost them their order over a cosmetic detail.
   */
  it('never returns an empty name', () => {
    expect(resolveReceiverName({ telegramId: TELEGRAM_ID })).toBe(`TMA-${TELEGRAM_ID}`)
    expect(
      resolveReceiverName({
        bankOwnerName: '',
        firstName: '',
        lastName: '',
        username: '',
        telegramId: TELEGRAM_ID,
      }),
    ).toBe(`TMA-${TELEGRAM_ID}`)
  })
})
