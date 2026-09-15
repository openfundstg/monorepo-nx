import { isAccountNotCard, readRecipientCard } from './masked-card.util'

describe('readRecipientCard', () => {
  /** The exact string `check.gov.ua` returned for a real monobank transfer. */
  it('reads a masked card out of a rendered recipient', () => {
    expect(readRecipientCard('Ілля К., 444111******8671')).toBe('444111******8671')
  })

  /**
   * PrivatBank names the recipient's card in full when the money leaves
   * PrivatBank. `matchesMaskedCard` compares position by position, so a run
   * with no asterisks simply compares every digit — an exact match where the
   * masked one is only a probable one.
   */
  it('reads a card stated in full', () => {
    expect(readRecipientCard('Рахунок отримувача 4441110000005500')).toBe('4441110000005500')
  })

  it.each([
    ['a different split', 'Хтось, 4441********8671', '4441********8671'],
    ['no name at all', '444111******8671', '444111******8671'],
    ['trailing text', '444111******8671 (Universal)', '444111******8671']
  ])('handles %s', (_name, rendered, expected) => {
    expect(readRecipientCard(rendered)).toBe(expected)
  })

  /**
   * Every one of these must be `null`, and `null` is a refusal upstream. A
   * recipient this build cannot read is a recipient that has not been checked,
   * and the card is the strongest of the three checks a receipt faces.
   */
  it.each([
    ['a name with no card', 'Ілля К.'],
    ['a mask that is too short', 'Ілля К., 4441**8671'],
    ['a mask that is too long', 'Ілля К., 4441111*******86718'],
    ['a longer number that merely contains one', 'IBAN UA21444111******86710000'],
    ['an IBAN, which contains many sixteen-digit windows', 'UA620000000000000000000000001'],
    ['nothing', '']
  ])('refuses %s', (_name, rendered) => {
    expect(readRecipientCard(rendered)).toBeNull()
  })
})

describe('isAccountNotCard', () => {
  /**
   * Its own question, and asked before a card is looked for, because the two
   * failures mean opposite things: an IBAN is an ordinary receipt this product
   * cannot match, and an unreadable rendering is a parser somebody should look
   * at. PrivatBank prints an IBAN on every transfer that stays inside
   * PrivatBank.
   */
  it.each([
    'UA620000000000000000000000001',
    'Рахунок отримувача UA080000000000000000000000003',
    'ua780000000000000000000000004'
  ])('recognises %s as an account', (rendered) => {
    expect(isAccountNotCard(rendered)).toBe(true)
  })

  it.each([
    ['a masked card', 'Ілля К., 444111******8671'],
    ['a card in full', '4441110000005500'],
    ['a document code that starts with letters', 'P24A0000000000A0000'],
    ['nothing', '']
  ])('does not mistake %s for one', (_name, rendered) => {
    expect(isAccountNotCard(rendered)).toBe(false)
  })
})
